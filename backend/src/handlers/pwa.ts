import { Hono } from 'hono';
import type { Env, PaymentMethod, ParsedInvoice, UnmatchedInvoiceDetail, Invoice, InvoiceItem, MarkReadRequest } from '../types';
import { androidAuth } from '../middleware/android-auth';
import { getSupabaseClient } from '../db/client';
import {
  insertTransaction,
  insertTransactionItems,
  updateParentTransactionId,
  findParentCandidates,
  createImportRun,
  updateImportRun,
  getTransactionsForPeriod,
  insertAdjustments,
  computeAndWriteEffectiveAmounts,
  getAdjustmentsForTransaction,
  deleteAdjustmentsForTransaction,
  findAllAmbiguousInvoices,
  findAllMatchedInvoices,
  markInvoicesRead,
  getTransactionsByIds,
  getTransactionItemsByTransactionIds,
  findExistingInvoiceNumbers,
  fetchImportCandidateTransactions,
  fetchDiscountSumsByTransaction,
  findTransactionsWithoutInvoiceInRange,
  enrichTransaction,
  clearTransactionInvoiceLink,
  linkInvoiceToTransaction,
  resetInvoiceToAmbiguous,
  insertInvoice,
  deleteInvoice,
  deleteTransactionItemsBySourceInvoice,
  getTransactionItems,
  renameTransactionItem,
  updateTransactionItemTags,
  type TransactionForPeriod,
} from '../db/queries';
import { getBudgetProgress } from '../services/budget';
import { runImportPipeline, computeConfidence, applyInvoiceItems, selectExactDiscountCandidates, selectForexCandidates } from '../services/invoice-matcher';
import { decodeCSVBuffer, parseCSVRows, groupInvoices, RowLimitError } from '../services/csv-parser';
import { aggregateByCategory, aggregateBySubcategory } from '../services/summary';
import { mergeItemCategoryTag, itemWriteTags } from '../services/item-category';

interface PwaEnv { Bindings: Env }

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'credit_card', 'easy_card', 'prepaid_wallet', 'bank_account'];

function txHasPlainTag(tx: { tags: string[]; transaction_items: { tags: string[] }[] }, tag: string): boolean {
  const isPlain = (t: string) => t === tag;
  return tx.tags.some(isPlain) || tx.transaction_items.some((item) => item.tags.some(isPlain));
}

function enrichRefundTags(txs: TransactionForPeriod[]): TransactionForPeriod[] {
  const txById = new Map(txs.map((tx) => [tx.id, tx]));
  return txs.map((tx) => {
    if (tx.transaction_type !== 'refund' || !tx.parent_transaction_id) return tx;
    const allTags = [...tx.tags, ...tx.transaction_items.flatMap((i) => i.tags)];
    if (allTags.some((t) => t.includes(':'))) return tx;
    const parent = txById.get(tx.parent_transaction_id);
    if (!parent) return tx;
    const parentTag = [...parent.tags, ...parent.transaction_items.flatMap((i) => i.tags)].find((t) => t.includes(':'));
    if (!parentTag) return tx;
    return { ...tx, tags: [...tx.tags, parentTag] };
  });
}

export const pwaRouter = new Hono<PwaEnv>();

// CORS — handles OPTIONS preflight before auth runs
pwaRouter.use('/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': c.env.PWA_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Max-Age': '86400',
      },
    });
  }
  await next();
  c.res.headers.set('Access-Control-Allow-Origin', c.env.PWA_ORIGIN);
});

pwaRouter.use('/*', androidAuth);

// ─── GET /pwa/categories ─────────────────────────────────────────────────────

pwaRouter.get('/categories', async (c) => {
  const supabase = getSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('categories')
    .select('major, subcategory, sort_order')
    .order('major')
    .order('sort_order');
  if (error) return c.json({ error: 'DB_ERROR', message: error.message }, 500);
  return c.json({ categories: data });
});

// ─── GET /pwa/tags ───────────────────────────────────────────────────────────

pwaRouter.get('/tags', async (c) => {
  const supabase = getSupabaseClient(c.env);
  const since = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('transactions')
    .select('tags')
    .gte('transaction_at', since)
    .limit(2000);
  if (error) return c.json({ error: 'DB_ERROR', message: error.message }, 500);
  const allTags = (data ?? []).flatMap((row) => (row.tags as string[]) ?? []);
  const plainTags = [...new Set(allTags.filter((t) => !t.includes(':')))].sort();
  return c.json({ tags: plainTags });
});

// ─── POST /pwa/expense ───────────────────────────────────────────────────────

pwaRouter.post('/expense', async (c) => {
  interface AdjInput { kind: 'fee' | 'refund' | 'discount'; amount: number; note?: string | null; basis?: 'percentage' | null; basis_value?: number | null }
  interface Body {
    amount: number;
    payment_method: string;
    category_tag?: string | null;
    free_tags?: string[];
    note?: string | null;
    items?: { name: string; amount?: number | null; tag?: string | null; note?: string | null }[];
    adjustments?: AdjInput[];
  }
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }

  const { amount, payment_method, category_tag, free_tags: rawTags = [], note, items = [], adjustments = [] } = body;
  const free_tags = rawTags
    .map((t) => t.replace(/^[#\s]+|[#\s]+$/g, ''))
    .filter(Boolean)
    .filter((t) => !t.includes(':'));

  if (!Number.isInteger(amount) || amount <= 0) {
    return c.json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive integer' }, 400);
  }
  if (!PAYMENT_METHODS.includes(payment_method as PaymentMethod)) {
    return c.json({ error: 'INVALID_PAYMENT_METHOD', message: `payment_method must be one of: ${PAYMENT_METHODS.join(', ')}` }, 400);
  }
  for (const item of items) {
    if (item.amount != null && (!Number.isInteger(item.amount) || item.amount <= 0)) {
      return c.json({ error: 'INVALID_ITEM_AMOUNT', message: 'item amounts must be positive integers when set' }, 400);
    }
  }
  for (const adj of adjustments) {
    if (!['fee', 'refund', 'discount'].includes(adj.kind)) {
      return c.json({ error: 'INVALID_ADJUSTMENT_KIND', message: 'adjustment kind must be fee, refund, or discount' }, 400);
    }
    if (!Number.isInteger(adj.amount) || adj.amount <= 0) {
      return c.json({ error: 'INVALID_ADJUSTMENT_AMOUNT', message: 'adjustment amount must be a positive integer' }, 400);
    }
    if (adj.basis != null && adj.basis !== 'percentage') {
      return c.json({ error: 'INVALID_ADJUSTMENT_BASIS', message: "basis must be 'percentage' or null" }, 400);
    }
    if (adj.basis_value != null && (!Number.isInteger(adj.basis_value) || adj.basis_value <= 0 || adj.basis_value > 100)) {
      return c.json({ error: 'INVALID_ADJUSTMENT_BASIS_VALUE', message: 'basis_value must be 1..100' }, 400);
    }
  }

  const supabase = getSupabaseClient(c.env);
  const txAt = new Date().toISOString();
  const tx = await insertTransaction(supabase, {
    amount,
    payment_method: payment_method as PaymentMethod,
    // B2: the tx-level category is the single source of truth (category first per the
    // legacy tags[0] write convention; plain tags follow). Items below store a tag
    // only as a deliberate override — inheriting items stay untagged and follow the
    // tx live via the summary's remainder logic.
    tags: category_tag != null ? [category_tag, ...free_tags] : free_tags,
    note: note ?? null,
    transaction_type: 'expense',
    transaction_at: txAt,
  });

  if (items.length > 0) {
    await insertTransactionItems(
      supabase,
      tx.id,
      items.map((item, i) => ({
        name: item.name,
        amount: item.amount ?? null,
        tags: itemWriteTags(category_tag ?? null, item.tag ?? null),
        sort_order: i,
        note: item.note?.trim() || null,
      }))
    );
  }

  if (adjustments.length > 0) {
    await insertAdjustments(supabase, tx.id, adjustments.map((a) => ({ ...a, transaction_at: txAt })));
  }

  // Recompute effective_amount whenever items exist
  if (items.length > 0) {
    await computeAndWriteEffectiveAmounts(supabase, tx.id, amount);
  }

  return c.json({ id: tx.id, amount: tx.amount, transaction_at: tx.transaction_at }, 201);
});

// ─── GET /pwa/summary ────────────────────────────────────────────────────────

pwaRouter.get('/summary', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return c.json({ error: 'MISSING_PARAMS', message: 'from and to are required' }, 400);

  const start = new Date(from);
  const end = new Date(`${to}T23:59:59.999Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return c.json({ error: 'INVALID_DATE', message: 'from and to must be valid ISO dates' }, 400);
  }

  const tag = c.req.query('tag') || null;
  const paymentMethod = c.req.query('payment_method') || null;

  const supabase = getSupabaseClient(c.env);
  let txs = await getTransactionsForPeriod(supabase, start, end);
  if (paymentMethod) txs = txs.filter((tx) => tx.payment_method === paymentMethod);
  if (tag) txs = txs.filter((tx) => txHasPlainTag(tx, tag));

  const grandTotal = txs.reduce((s, tx) => s + (tx.transaction_type === 'refund' ? -tx.amount : tx.amount), 0);
  const rawTotals = aggregateByCategory(enrichRefundTags(txs));
  const categories = rawTotals.map((t) => ({
    category: t.category,
    total: t.total,
    percentage: grandTotal > 0 ? Math.round((t.total / grandTotal) * 1000) / 10 : 0,
  }));
  return c.json({ grand_total: grandTotal, categories });
});

// ─── GET /pwa/summary/subcategories ──────────────────────────────────────────

pwaRouter.get('/summary/subcategories', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const major = c.req.query('major');
  if (!from || !to || !major) {
    return c.json({ error: 'MISSING_PARAMS', message: 'from, to, and major are required' }, 400);
  }

  const tag = c.req.query('tag') || null;
  const paymentMethod = c.req.query('payment_method') || null;

  const start = new Date(from);
  const end = new Date(`${to}T23:59:59.999Z`);
  const supabase = getSupabaseClient(c.env);
  let txs = await getTransactionsForPeriod(supabase, start, end);
  if (paymentMethod) txs = txs.filter((tx) => tx.payment_method === paymentMethod);
  if (tag) txs = txs.filter((tx) => txHasPlainTag(tx, tag));

  const rawTotals = aggregateBySubcategory(enrichRefundTags(txs), major);
  const total = txs
    .filter((tx) => {
      const allTags = [...tx.tags, ...tx.transaction_items.flatMap((i) => i.tags)];
      return allTags.some((t) => t === major || t.startsWith(`${major}:`));
    })
    .reduce((s, tx) => s + (tx.transaction_type === 'refund' ? -tx.amount : tx.amount), 0);
  const subcategories = rawTotals.map((t) => ({
    subcategory: t.subcategory,
    total: t.total,
    percentage: total > 0 ? Math.round((t.total / total) * 1000) / 10 : 0,
  }));
  return c.json({ major, total, subcategories });
});

// ─── GET /pwa/transaction-periods ────────────────────────────────────────────

pwaRouter.get('/transaction-periods', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return c.json({ error: 'MISSING_PARAMS', message: 'from and to are required' }, 400);

  const supabase = getSupabaseClient(c.env);
  const { data, error } = await supabase.rpc('get_transaction_periods', {
    p_start: from,
    p_end: `${to}T23:59:59.999Z`,
  });

  if (error) return c.json({ error: 'DB_ERROR', message: error.message }, 500);
  return c.json(data ?? []);
});

// ─── GET /pwa/transactions ───────────────────────────────────────────────────

pwaRouter.get('/transactions', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) return c.json({ error: 'MISSING_PARAMS', message: 'from and to are required' }, 400);

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(5000, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50));
  const category = c.req.query('category');
  const tag = c.req.query('tag') || null;
  const paymentMethod = c.req.query('payment_method') || null;

  const supabase = getSupabaseClient(c.env);
  let query = supabase
    .from('transactions')
    .select(
      'id, amount, transaction_type, payment_method, tags, note, transaction_at, created_at, parent_transaction_id, transaction_items(id, name, amount, tags)',
      { count: 'exact' }
    )
    .gte('transaction_at', from)
    .lte('transaction_at', `${to}T23:59:59.999Z`)
    .order('transaction_at', { ascending: false });

  if (paymentMethod) query = query.eq('payment_method', paymentMethod);

  const { data, error, count } = await query.range((page - 1) * limit, page * limit - 1);

  if (error) return c.json({ error: 'DB_ERROR', message: error.message }, 500);

  interface TxRow {
    id: string; amount: number; transaction_type: string; payment_method: string;
    tags: string[]; note: string | null; transaction_at: string; created_at: string; parent_transaction_id: string | null;
    transaction_items: { id: string; name: string; amount: number | null; tags: string[] }[];
  }
  let transactions = (data ?? []) as TxRow[];

  if (category) {
    const matchesCategory = (tags: string[]) =>
      tags.some((t) => t === category || t.startsWith(`${category}:`));
    transactions = transactions.filter((tx) =>
      tx.transaction_items.some((item) => matchesCategory(item.tags)) ||
      matchesCategory(tx.tags)
    );
  }
  if (tag) transactions = transactions.filter((tx) => txHasPlainTag(tx, tag));

  return c.json({
    total: count ?? 0,
    page,
    transactions: transactions.map(({ transaction_items, ...rest }) => ({ ...rest, items: transaction_items })),
  });
});

// ─── Edit-history helpers ─────────────────────────────────────────────────────

interface HistoryItem { name: string; amount: number | null; tags: string[]; note: string | null }
interface HistoryAdj { kind: string; amount: number; note: string | null; basis: string | null; basis_value: number | null }

async function readItemsForDiff(supabase: ReturnType<typeof getSupabaseClient>, txId: string): Promise<HistoryItem[]> {
  const { data, error } = await supabase
    .from('transaction_items')
    .select('name, amount, tags, note')
    .eq('transaction_id', txId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`readItemsForDiff: ${error.message}`);
  return (data ?? []).map((r) => ({
    name: r.name as string,
    amount: r.amount as number | null,
    tags: (r.tags as string[]) ?? [],
    note: (r.note as string | null) ?? null,
  }));
}

function computeEditDiff(
  before: { amount: number; payment_method: string; tags: string[]; note: string | null; items: HistoryItem[]; adjustments: HistoryAdj[] },
  after:  { amount: number; payment_method: string; free_tags: string[]; note: string | null; items: HistoryItem[]; adjustments: HistoryAdj[] }
): Record<string, unknown> | null {
  const norm = (n: string | null | undefined) => n?.trim() || null;
  const tagsEq = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const itemsEq = (a: HistoryItem[], b: HistoryItem[]) =>
    JSON.stringify(a.map((i) => ({ name: i.name, amount: i.amount, tags: i.tags, note: i.note }))) ===
    JSON.stringify(b.map((i) => ({ name: i.name, amount: i.amount, tags: i.tags, note: i.note })));
  const adjsEq = (a: HistoryAdj[], b: HistoryAdj[]) =>
    JSON.stringify(a.map((x) => ({ kind: x.kind, amount: x.amount, note: x.note, basis: x.basis, basis_value: x.basis_value }))) ===
    JSON.stringify(b.map((x) => ({ kind: x.kind, amount: x.amount, note: x.note, basis: x.basis, basis_value: x.basis_value })));

  const header: Record<string, { before: unknown; after: unknown }> = {};
  if (before.amount !== after.amount)                header.amount          = { before: before.amount,          after: after.amount };
  if (before.payment_method !== after.payment_method) header.payment_method = { before: before.payment_method,  after: after.payment_method };
  if (norm(before.note) !== norm(after.note))         header.note           = { before: before.note,            after: after.note };
  if (!tagsEq(before.tags, after.free_tags))          header.tags           = { before: before.tags,            after: after.free_tags };

  const diff: Record<string, unknown> = {};
  if (Object.keys(header).length > 0)     diff.header      = header;
  if (!itemsEq(before.items, after.items)) diff.items       = { before: before.items, after: after.items };
  if (!adjsEq(before.adjustments, after.adjustments)) diff.adjustments = { before: before.adjustments, after: after.adjustments };

  return Object.keys(diff).length > 0 ? diff : null;
}

// ─── GET /pwa/transactions/:id ───────────────────────────────────────────────

pwaRouter.get('/transactions/:id', async (c) => {
  const txId = c.req.param('id');
  const supabase = getSupabaseClient(c.env);

  const { data: tx, error } = await supabase
    .from('transactions')
    .select('id, amount, payment_method, tags, note, transaction_at, transaction_type, transaction_items(id, name, amount, tags, note, sort_order)')
    .eq('id', txId)
    .single();

  if (error || !tx) return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404);

  const [adjustments, historyRows] = await Promise.all([
    getAdjustmentsForTransaction(supabase, txId),
    supabase
      .from('transaction_edit_history')
      .select('id, edited_at, diff')
      .eq('transaction_id', txId)
      .order('edited_at', { ascending: true })
      .then(({ data }) => data ?? []),
  ]);

  interface ItemRow { id: string; name: string; amount: number | null; tags: string[]; note: string | null; sort_order: number }
  const items = ((tx.transaction_items as ItemRow[]) ?? []).sort((a, b) => a.sort_order - b.sort_order);

  return c.json({
    id: tx.id,
    amount: tx.amount,
    payment_method: tx.payment_method,
    tags: (tx.tags as string[]) ?? [],
    note: (tx.note as string | null) ?? null,
    transaction_at: tx.transaction_at,
    transaction_type: tx.transaction_type,
    items: items.map((i) => ({ id: i.id, name: i.name, amount: i.amount, tags: i.tags ?? [], note: i.note ?? null, sort_order: i.sort_order })),
    adjustments: adjustments.map((a) => ({
      id: a.id,
      kind: a.kind,
      amount: a.amount,
      note: a.note ?? null,
      basis: a.basis ?? null,
      basis_value: a.basis_value ?? null,
    })),
    history: historyRows.map((h) => ({ id: h.id, edited_at: h.edited_at, diff: h.diff })),
  });
});

// ─── PUT /pwa/transactions/:id ───────────────────────────────────────────────

pwaRouter.put('/transactions/:id', async (c) => {
  const txId = c.req.param('id');
  interface AdjInput { kind: 'fee' | 'refund' | 'discount'; amount: number; note?: string | null; basis?: 'percentage' | null; basis_value?: number | null }
  interface Body {
    amount: number;
    payment_method: string;
    category_tag?: string | null;
    free_tags?: string[];
    note?: string | null;
    items?: { name: string; amount?: number | null; tag?: string | null; note?: string | null }[];
    adjustments?: AdjInput[];
  }

  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }

  const { amount, payment_method, category_tag, free_tags: rawTags = [], note, items = [], adjustments = [] } = body;
  const free_tags = rawTags
    .map((t) => t.replace(/^[#\s]+|[#\s]+$/g, ''))
    .filter(Boolean)
    .filter((t) => !t.includes(':'));

  if (!Number.isInteger(amount) || amount <= 0)
    return c.json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive integer' }, 400);
  if (!PAYMENT_METHODS.includes(payment_method as PaymentMethod))
    return c.json({ error: 'INVALID_PAYMENT_METHOD', message: `payment_method must be one of: ${PAYMENT_METHODS.join(', ')}` }, 400);
  for (const item of items) {
    if (item.amount != null && (!Number.isInteger(item.amount) || item.amount <= 0))
      return c.json({ error: 'INVALID_ITEM_AMOUNT', message: 'item amounts must be positive integers when set' }, 400);
  }
  for (const adj of adjustments) {
    if (!['fee', 'refund', 'discount'].includes(adj.kind))
      return c.json({ error: 'INVALID_ADJUSTMENT_KIND', message: 'adjustment kind must be fee, refund, or discount' }, 400);
    if (!Number.isInteger(adj.amount) || adj.amount <= 0)
      return c.json({ error: 'INVALID_ADJUSTMENT_AMOUNT', message: 'adjustment amount must be a positive integer' }, 400);
    if (adj.basis != null && adj.basis !== 'percentage')
      return c.json({ error: 'INVALID_ADJUSTMENT_BASIS', message: "basis must be 'percentage' or null" }, 400);
    if (adj.basis_value != null && (!Number.isInteger(adj.basis_value) || adj.basis_value <= 0 || adj.basis_value > 100))
      return c.json({ error: 'INVALID_ADJUSTMENT_BASIS_VALUE', message: 'basis_value must be 1..100' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  const { data: tx, error: txErr } = await supabase
    .from('transactions')
    .select('id, transaction_type, transaction_at, amount, payment_method, tags, note')
    .eq('id', txId)
    .single();
  if (txErr || !tx) return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404);
  if (tx.transaction_type !== 'expense') return c.json({ error: 'NOT_EXPENSE', message: 'Only expense transactions can be edited' }, 403);

  // Capture before-state for audit history
  const [beforeItems, beforeAdjs] = await Promise.all([
    readItemsForDiff(supabase, txId),
    getAdjustmentsForTransaction(supabase, txId),
  ]);

  // B2: the tx-level category is the single source of truth (category first per the
  // legacy tags[0] write convention; plain tags follow). Items keep a tag only as a
  // deliberate override; inheriting items follow the tx live at read time.
  const txTags = category_tag != null ? [category_tag, ...free_tags] : free_tags;
  const { error: updateErr } = await supabase
    .from('transactions')
    .update({ amount, payment_method, tags: txTags, note: note ?? null })
    .eq('id', txId);
  if (updateErr) return c.json({ error: 'DB_ERROR', message: updateErr.message }, 500);

  const { error: delItemsErr } = await supabase.from('transaction_items').delete().eq('transaction_id', txId);
  if (delItemsErr) return c.json({ error: 'DB_ERROR', message: delItemsErr.message }, 500);

  const afterItems: HistoryItem[] = items.map((item) => ({
    name: item.name,
    amount: item.amount ?? null,
    tags: itemWriteTags(category_tag ?? null, item.tag ?? null),
    note: item.note?.trim() || null,
  }));

  if (afterItems.length > 0) {
    await insertTransactionItems(
      supabase,
      txId,
      afterItems.map((item, i) => ({ ...item, sort_order: i }))
    );
  }

  await deleteAdjustmentsForTransaction(supabase, txId);
  const afterAdjs: HistoryAdj[] = adjustments.map((a) => ({
    kind: a.kind,
    amount: a.amount,
    note: a.note ?? null,
    basis: a.basis ?? null,
    basis_value: a.basis_value ?? null,
  }));
  if (adjustments.length > 0) {
    await insertAdjustments(supabase, txId, adjustments.map((a) => ({ ...a, transaction_at: tx.transaction_at as string })));
  }

  if (afterItems.length > 0) {
    await computeAndWriteEffectiveAmounts(supabase, txId, amount);
  }

  const diff = computeEditDiff(
    { amount: tx.amount as number, payment_method: tx.payment_method as string, tags: (tx.tags as string[]) ?? [], note: (tx.note as string | null) ?? null, items: beforeItems, adjustments: beforeAdjs.map((a) => ({ kind: a.kind, amount: a.amount, note: a.note, basis: a.basis, basis_value: a.basis_value })) },
    { amount, payment_method, free_tags: txTags, note: note ?? null, items: afterItems, adjustments: afterAdjs }
  );
  if (diff !== null) {
    await supabase.from('transaction_edit_history').insert({ transaction_id: txId, diff });
  }

  return c.json({ ok: true });
});

// ─── PATCH /pwa/transactions/:id/items/:itemId ───────────────────────────────
// Feature 026: assign / reassign / clear a single item's category inline (from the
// import review or the Summary list) without a full-transaction rewrite. Only the
// item's `tags` change — amount / effective_amount stay put (FR-012). Plain tags are
// preserved; the single category (`:`-)tag is replaced in place (idempotent re-assign).
// Feature 027 (B2): `null` = inherit the tx category (live); a tag equal to the tx's
// current category collapses to inherit (FR-013); the EXPLICIT_UNCATEGORIZED sentinel
// is stored verbatim (deliberate 其他).
pwaRouter.patch('/transactions/:id/items/:itemId', async (c) => {
  const txId = c.req.param('id');
  const itemId = c.req.param('itemId');

  interface Body { category_tag?: string | null }
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }
  const categoryTag = body.category_tag ?? null;
  if (categoryTag !== null && (typeof categoryTag !== 'string' || categoryTag.trim() === '')) {
    return c.json({ error: 'INVALID_CATEGORY_TAG', message: 'category_tag must be a non-empty string or null' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  const { data: tx, error: txErr } = await supabase
    .from('transactions')
    .select('id, transaction_type, amount, payment_method, tags, note')
    .eq('id', txId)
    .single();
  if (txErr || !tx) return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404);
  if (tx.transaction_type !== 'expense') return c.json({ error: 'NOT_EXPENSE', message: 'Only expense transactions can be edited' }, 403);

  const { data: item, error: itemErr } = await supabase
    .from('transaction_items')
    .select('id, tags')
    .eq('id', itemId)
    .eq('transaction_id', txId)
    .single();
  if (itemErr || !item) return c.json({ error: 'NOT_FOUND', message: 'Item not found' }, 404);

  const currentTags = ((item.tags as string[]) ?? []);
  // B2 (FR-013): picking the tx's own category means "follow the transaction" — collapse to inherit.
  const txCategoryTag = ((tx.tags as string[]) ?? []).find((t) => t.includes(':')) ?? null;
  const effectiveAssign = categoryTag !== null && categoryTag === txCategoryTag ? null : categoryTag;
  const newTags = mergeItemCategoryTag(currentTags, effectiveAssign);

  // Idempotent: same tags → no write, no audit row (data-model invariant 5).
  if (JSON.stringify(newTags) === JSON.stringify(currentTags)) {
    return c.json({ ok: true });
  }

  // Items-only audit diff (header + adjustments unchanged), consistent with PUT.
  const [beforeItems, beforeAdjs] = await Promise.all([
    readItemsForDiff(supabase, txId),
    getAdjustmentsForTransaction(supabase, txId),
  ]);

  await updateTransactionItemTags(supabase, itemId, newTags);

  const afterItems = await readItemsForDiff(supabase, txId);
  const adjs = beforeAdjs.map((a) => ({ kind: a.kind, amount: a.amount, note: a.note, basis: a.basis, basis_value: a.basis_value }));
  const sharedHeader = {
    amount: tx.amount as number,
    payment_method: tx.payment_method as string,
    note: (tx.note as string | null) ?? null,
    adjustments: adjs,
  };
  const diff = computeEditDiff(
    { ...sharedHeader, tags: (tx.tags as string[]) ?? [], items: beforeItems },
    { ...sharedHeader, free_tags: (tx.tags as string[]) ?? [], items: afterItems }
  );
  if (diff !== null) {
    await supabase.from('transaction_edit_history').insert({ transaction_id: txId, diff });
  }

  return c.json({ ok: true });
});

// ─── GET /pwa/parent-search ──────────────────────────────────────────────────

pwaRouter.get('/parent-search', async (c) => {
  const q = c.req.query('q');
  if (!q || !q.trim()) return c.json({ error: 'MISSING_QUERY', message: 'q is required' }, 400);

  const daysParam = c.req.query('days');
  const days = daysParam === 'all' ? 36500 : Math.max(1, parseInt(daysParam ?? '90', 10) || 90);

  const supabase = getSupabaseClient(c.env);
  const candidates = await findParentCandidates(supabase, q.trim(), days);
  const transactions = candidates.map((tx) => ({
    id: tx.id,
    amount: tx.amount,
    note: tx.note,
    tags: (tx.tags as string[]) ?? [],
    transaction_at: tx.transaction_at,
    item_names: (tx.transaction_items as { name: string }[]).map((i) => i.name),
  }));
  return c.json({ transactions });
});

// ─── POST /pwa/fee ───────────────────────────────────────────────────────────

pwaRouter.post('/fee', async (c) => {
  interface Body { amount: number; description: string; parent_transaction_id?: string | null }
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD' }, 400);
  }

  const { amount, description, parent_transaction_id } = body;
  if (!Number.isInteger(amount) || amount <= 0) {
    return c.json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive integer' }, 400);
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    return c.json({ error: 'MISSING_DESCRIPTION', message: 'description is required' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  let transaction_at = new Date().toISOString();
  const note = description.trim() || null;

  if (parent_transaction_id) {
    const { data: parent } = await supabase
      .from('transactions')
      .select('transaction_at')
      .eq('id', parent_transaction_id)
      .single();
    if (parent) {
      transaction_at = parent.transaction_at;
    }
  }

  const tx = await insertTransaction(supabase, {
    amount,
    payment_method: 'credit_card',
    tags: [],
    note,
    transaction_type: 'fee',
    transaction_at,
  });

  if (parent_transaction_id) {
    await updateParentTransactionId(supabase, tx.id, parent_transaction_id);
  }

  await insertTransactionItems(supabase, tx.id, [{ name: description || `於 ${transaction_at.slice(0, 10)} 計費`, amount, tags: [] }]);

  return c.json({ id: tx.id, amount: tx.amount, transaction_at: tx.transaction_at }, 201);
});

// ─── POST /pwa/refund ────────────────────────────────────────────────────────

pwaRouter.post('/refund', async (c) => {
  interface Body { amount: number; description: string; payment_method: string; parent_transaction_id?: string | null }
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD' }, 400);
  }

  const { amount, description, payment_method, parent_transaction_id } = body;
  if (!Number.isInteger(amount) || amount <= 0) {
    return c.json({ error: 'INVALID_AMOUNT', message: 'amount must be a positive integer' }, 400);
  }
  if (!description || typeof description !== 'string' || !description.trim()) {
    return c.json({ error: 'MISSING_DESCRIPTION', message: 'description is required' }, 400);
  }
  if (!PAYMENT_METHODS.includes(payment_method as PaymentMethod)) {
    return c.json({ error: 'INVALID_PAYMENT_METHOD' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  let transaction_at = new Date().toISOString();
  const note = description.trim() || null;
  let parentCategoryTag: string | null = null;

  if (parent_transaction_id) {
    const { data: parent } = await supabase
      .from('transactions')
      .select('transaction_at, tags, transaction_items(tags)')
      .eq('id', parent_transaction_id)
      .single();
    if (parent) {
      transaction_at = parent.transaction_at;
      const allParentTags = [
        ...(parent.tags as string[]),
        ...((parent.transaction_items as { tags: string[] }[]).flatMap((i) => i.tags)),
      ];
      parentCategoryTag = allParentTags.find((t) => t.includes(':')) ?? null;
    }
  }

  const tx = await insertTransaction(supabase, {
    amount,
    payment_method: payment_method as PaymentMethod,
    tags: parentCategoryTag ? [parentCategoryTag] : [],
    note,
    transaction_type: 'refund',
    transaction_at,
  });

  if (parent_transaction_id) {
    await updateParentTransactionId(supabase, tx.id, parent_transaction_id);
  }

  // B2: the refund tx carries the parent-category snapshot at tx level (above); its
  // item inherits from its own transaction rather than storing a redundant copy.
  await insertTransactionItems(supabase, tx.id, [{ name: description || `退款`, amount, tags: [] }]);

  return c.json({ id: tx.id, amount: tx.amount, transaction_at: tx.transaction_at }, 201);
});

// ─── POST /pwa/import ────────────────────────────────────────────────────────

pwaRouter.post('/import', async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'INVALID_CSV', message: 'Expected multipart/form-data with a file field' }, 400);
  }

  const fileEntry = formData.get('file');
  if (!fileEntry || typeof fileEntry === 'string') {
    return c.json({ error: 'INVALID_CSV', message: 'No file field found in form data' }, 400);
  }
  const file = fileEntry as File;

  const buffer = await file.arrayBuffer();
  const csvText = decodeCSVBuffer(buffer);

  let rows: import('../types').RawInvoiceRow[];
  let parseFailedCount: number;
  try {
    ({ rows, parseFailedCount } = parseCSVRows(csvText));
  } catch (err) {
    return c.json({ error: 'INVALID_CSV', message: String(err) }, 400);
  }

  let invoices: import('../types').ParsedInvoice[];
  let skippedVoidedCount: number;
  let skippedZeroCount: number;
  try {
    ({ invoices, skippedVoidedCount, skippedZeroCount } = groupInvoices(rows));
  } catch (err) {
    if (err instanceof RowLimitError) {
      return c.json({ error: 'ROW_LIMIT_EXCEEDED', message: `CSV contains ${err.actual} invoices; max is 1000` }, 400);
    }
    return c.json({ error: 'INVALID_CSV', message: String(err) }, 400);
  }

  const supabase = getSupabaseClient(c.env);
  const importRun = await createImportRun(supabase, file.name ?? null);

  let counters: Awaited<ReturnType<typeof runImportPipeline>>;
  try {
    counters = await runImportPipeline(supabase, invoices, importRun.id, {
      voidedCount: skippedVoidedCount,
      zeroCount: skippedZeroCount,
      parseFailedCount,
    });
  } catch (err) {
    console.error('[import] pipeline error:', err);
    return c.json({ error: 'PIPELINE_ERROR', message: String(err) }, 500);
  }

  const totalRows =
    counters.matchedExact + counters.matchedNear + counters.ambiguous +
    counters.skippedUnmatched + counters.skippedDuplicate +
    counters.skippedVoided + counters.skippedZero + counters.parseFailed;

  await updateImportRun(supabase, importRun.id, {
    total_rows: totalRows,
    matched_count: counters.matchedExact + counters.matchedNear,
    matched_exact_count: counters.matchedExact,
    matched_near_count: counters.matchedNear,
    ambiguous_count: counters.ambiguous,
    skipped_unmatched_count: counters.skippedUnmatched,
    skipped_duplicate_count: counters.skippedDuplicate,
    skipped_voided_count: counters.skippedVoided,
    skipped_zero_count: counters.skippedZero,
    parse_failed_count: counters.parseFailed,
  });

  return c.json({
    filename: file.name ?? null,
    import_run_id: importRun.id,
    matched_exact: counters.matchedExact,
    matched_near: counters.matchedNear,
    ambiguous: counters.ambiguous,
    skipped_unmatched: counters.skippedUnmatched,
    skipped_duplicate: counters.skippedDuplicate,
    skipped_voided: counters.skippedVoided,
    skipped_zero: counters.skippedZero,
    matched: counters.matched,
    skipped_unmatched_detail: counters.skippedUnmatchedDetail,
  });
});

// ─── GET /pwa/import/ambiguous ────────────────────────────────────────────────
// Lists invoices held as `ambiguous` with their candidate transactions re-derived
// live (so candidates linked since import drop out via the matched_invoice_id filter).
// Feature 024: candidates are pre-fetched once over the union window and matched in
// memory (same bulk pattern as the import pipeline) to keep the endpoint within the
// Cloudflare Workers subrequest cap regardless of how many ambiguous invoices exist.

pwaRouter.get('/import/ambiguous', async (c) => {
  const supabase = getSupabaseClient(c.env);
  const invoices = await findAllAmbiguousInvoices(supabase);
  if (invoices.length === 0) return c.json({ ambiguous: [] });

  // One candidate fetch over the union window (earliest − 7d … latest + 7d).
  const times = invoices.map((inv) => new Date(inv.invoice_date).getTime());
  const windowStart = new Date(Math.min(...times) - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const windowEndInclusive = `${new Date(Math.max(...times) + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}T23:59:59Z`;
  const candidatePool = await fetchImportCandidateTransactions(supabase, windowStart, windowEndInclusive);

  const maxNet = Math.max(...invoices.map((inv) => inv.net_amount));
  const belowNetIds = candidatePool.filter((t) => t.amount < maxNet).map((t) => t.id);
  const discountByTx = await fetchDiscountSumsByTransaction(supabase, belowNetIds);
  const noConsumed = new Set<string>(); // listing is read-only; nothing is consumed

  // Derive each invoice's candidates in memory: exact/discount first, forex fallback.
  const derived = invoices.map((inv) => {
    const date = new Date(inv.invoice_date);
    let source: 'exact' | 'forex' = 'exact';
    let cands = selectExactDiscountCandidates(inv.net_amount, date, candidatePool, discountByTx, noConsumed);
    if (cands.length === 0) {
      source = 'forex';
      cands = selectForexCandidates(inv.net_amount, date, candidatePool, noConsumed);
    }
    return { inv, source, cands };
  });

  // One batched item fetch for every candidate shown.
  const candidateTxIds = [...new Set(derived.flatMap((d) => d.cands.map((t) => t.id)))];
  const candidateItems = await getTransactionItemsByTransactionIds(supabase, candidateTxIds);
  const itemsByTx = new Map<string, { name: string; amount: number | null }[]>();
  for (const it of candidateItems) {
    const list = itemsByTx.get(it.transaction_id) ?? [];
    list.push({ name: it.name, amount: it.amount });
    itemsByTx.set(it.transaction_id, list);
  }

  const entries = derived.map(({ inv, source, cands }) => ({
    id: inv.id,
    invoice_number: inv.invoice_number,
    seller_name: inv.seller_name,
    invoice_date: inv.invoice_date,
    net_amount: inv.net_amount,
    items: inv.items,
    candidate_source: source,
    candidates: cands.map((tx) => ({
      id: tx.id,
      transaction_at: tx.transaction_at,
      amount: tx.amount,
      note: tx.note,
      tags: tx.tags,
      items: itemsByTx.get(tx.id) ?? [],
    })),
  }));

  return c.json({ ambiguous: entries });
});

// ─── POST /pwa/import/resolve ─────────────────────────────────────────────────
// Manually link an ambiguous invoice to a chosen transaction (FR-011). Ordered
// writes with the invoice status flipped LAST, so a mid-way failure leaves the
// invoice `ambiguous` and the call can be safely retried.

pwaRouter.post('/import/resolve', async (c) => {
  interface Body { invoice_id: string; transaction_id: string; replace_items?: boolean }
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }
  const { invoice_id, transaction_id, replace_items = false } = body;
  if (!invoice_id || !transaction_id) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'invoice_id and transaction_id are required' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  const { data: invoice, error: invErr } = await supabase
    .from('invoices').select('*').eq('id', invoice_id).single();
  if (invErr || !invoice) return c.json({ error: 'NOT_FOUND', message: 'Invoice not found' }, 404);
  if (invoice.match_status !== 'ambiguous') {
    return c.json({ error: 'INVOICE_NOT_AMBIGUOUS', message: 'Invoice is not awaiting resolution' }, 409);
  }

  const { data: tx, error: txErr } = await supabase
    .from('transactions').select('*').eq('id', transaction_id).single();
  if (txErr || !tx) return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404);
  if (tx.matched_invoice_id !== null) {
    return c.json({ error: 'TRANSACTION_ALREADY_LINKED', message: 'Transaction already linked to an invoice' }, 409);
  }

  // 1. Enrich the transaction.
  await enrichTransaction(supabase, tx.id, {
    invoiceNumber: invoice.invoice_number,
    sellerName: invoice.seller_name,
    sellerTaxId: invoice.seller_tax_id,
    invoiceId: invoice.id,
  });
  // 2. Handle items (replace, or fill-if-empty / keep).
  const itemsOutcome = await applyInvoiceItems(supabase, tx.id, invoice.items ?? [], replace_items, invoice.id);
  // 2b. Stamp net per-item spend from the paid amount so a discounted invoice's filled
  // items don't overcount in summaries (the allowance is folded out of the item amounts).
  // Only when we actually wrote items; 'kept' leaves the user's own items untouched.
  if (itemsOutcome !== 'kept') {
    await computeAndWriteEffectiveAmounts(supabase, tx.id, tx.amount);
  }
  // 3. Flip invoice status last.
  const confidence = computeConfidence(
    new Date(invoice.invoice_date).toISOString(), tx.transaction_at, tx.amount, invoice.net_amount
  );
  await linkInvoiceToTransaction(supabase, invoice.id, tx.id, confidence);

  return c.json({
    resolved: {
      seller_name: invoice.seller_name,
      invoice_number: invoice.invoice_number,
      transaction_at: tx.transaction_at,
      amount: tx.amount,
      confidence,
      items_outcome: itemsOutcome,
    },
  });
});

// ─── GET /pwa/import/matched ──────────────────────────────────────────────────
// Lists currently linked invoices with their matched transaction, so a wrong
// auto-match (e.g. an amount collision) can be spotted and undone.

pwaRouter.get('/import/matched', async (c) => {
  const includeRead = c.req.query('include_read') === 'true';
  const supabase = getSupabaseClient(c.env);
  const invoices = await findAllMatchedInvoices(supabase, includeRead);

  // Batched: one query for all linked transactions and one for their items (no
  // per-invoice N+1), so the review screen can show enough detail to judge a match.
  const txIds = [...new Set(
    invoices.map((inv) => inv.matched_transaction_id).filter((id): id is string => id != null)
  )];
  const txs = await getTransactionsByIds(supabase, txIds);
  const txById = new Map(txs.map((tx) => [tx.id, tx]));
  const itemRows = await getTransactionItemsByTransactionIds(supabase, txIds);
  const itemsByTx = new Map<string, { id: string; name: string; amount: number | null; tags: string[] }[]>();
  for (const it of itemRows) {
    const arr = itemsByTx.get(it.transaction_id) ?? [];
    arr.push({ id: it.id, name: it.name, amount: it.amount, tags: it.tags ?? [] });
    itemsByTx.set(it.transaction_id, arr);
  }

  const entries = invoices.map((inv) => {
    const tx = inv.matched_transaction_id ? txById.get(inv.matched_transaction_id) ?? null : null;
    return {
      id: inv.id,
      invoice_number: inv.invoice_number,
      seller_name: inv.seller_name,
      invoice_date: inv.invoice_date,
      net_amount: inv.net_amount,
      allowance: inv.allowance, // discount folded out of the line items; lets the client
                                // reconcile the displayed items (gross) back to net_amount
      match_confidence: inv.match_confidence,
      reviewed_at: inv.reviewed_at,
      items: inv.items, // invoice line items (name + amount), for at-a-glance verification
      transaction: tx ? { ...tx, items: itemsByTx.get(tx.id) ?? [] } : null,
    };
  });

  return c.json({ matched: entries });
});

// ─── POST /pwa/import/mark-read ───────────────────────────────────────────────
// Acknowledge ("mark as read") one or more matched invoices so they drop out of the
// review queue. Accepts a single invoice_id and/or a bulk invoice_ids[]; only
// `matched` invoices are acknowledgeable (US1, FR-005).

pwaRouter.post('/import/mark-read', async (c) => {
  let body: MarkReadRequest;
  try {
    body = await c.req.json<MarkReadRequest>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }
  const ids = [...new Set([
    ...(body.invoice_id ? [body.invoice_id] : []),
    ...(body.invoice_ids ?? []),
  ])];
  if (ids.length === 0) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'invoice_id or invoice_ids is required' }, 400);
  }

  const supabase = getSupabaseClient(c.env);
  const marked = await markInvoicesRead(supabase, ids);
  return c.json({ marked });
});

// Shared by unlink + rematch: detach the linked transaction (keeping it matched only if
// a receipt is still linked), remove only the items this invoice created (by provenance),
// and recompute effective amounts over what remains. The transaction is never deleted
// (SC-003). Differs only in what the caller does to the invoice row afterwards.
async function detachInvoiceTransaction(
  supabase: ReturnType<typeof getSupabaseClient>,
  invoiceId: string,
  txId: string | null
): Promise<void> {
  if (!txId) return;
  const { data: tx } = await supabase
    .from('transactions').select('amount, matched_receipt_id').eq('id', txId).single();
  await clearTransactionInvoiceLink(supabase, txId, tx?.matched_receipt_id != null);
  await deleteTransactionItemsBySourceInvoice(supabase, txId, invoiceId);
  if (tx) await computeAndWriteEffectiveAmounts(supabase, txId, tx.amount as number);
}

// ─── POST /pwa/import/unlink ──────────────────────────────────────────────────
// Reverses an invoice→transaction link: detach the transaction, remove the items this
// invoice created, recompute effective amounts, then DELETE the invoice row (full
// discard — re-attempted only on a future import). The transaction itself is never
// deleted (SC-003).

pwaRouter.post('/import/unlink', async (c) => {
  interface Body { invoice_id: string }
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }
  const { invoice_id } = body;
  if (!invoice_id) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'invoice_id is required' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  const { data: invoice, error: invErr } = await supabase
    .from('invoices').select('*').eq('id', invoice_id).single();
  if (invErr || !invoice) return c.json({ error: 'NOT_FOUND', message: 'Invoice not found' }, 404);
  if (invoice.match_status !== 'matched') {
    return c.json({ error: 'INVOICE_NOT_MATCHED', message: 'Invoice is not linked to a transaction' }, 409);
  }

  const txId = invoice.matched_transaction_id;
  await detachInvoiceTransaction(supabase, invoice_id, txId);
  // Delete the invoice row last (re-attempted on a future import).
  await deleteInvoice(supabase, invoice_id);

  return c.json({ unlinked: { invoice_number: invoice.invoice_number, transaction_id: txId } });
});

// ─── POST /pwa/import/rematch ─────────────────────────────────────────────────
// Like unlink, but instead of deleting the invoice it sends it back to the `ambiguous`
// backlog (待手動確認) so the user can re-pick the correct transaction (or 手動連結 to
// any tx) without re-importing. Detaches the wrong transaction first (SC-003: the
// transaction is never deleted).

pwaRouter.post('/import/rematch', async (c) => {
  interface Body { invoice_id: string }
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }
  const { invoice_id } = body;
  if (!invoice_id) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'invoice_id is required' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  const { data: invoice, error: invErr } = await supabase
    .from('invoices').select('*').eq('id', invoice_id).single();
  if (invErr || !invoice) return c.json({ error: 'NOT_FOUND', message: 'Invoice not found' }, 404);
  if (invoice.match_status !== 'matched') {
    return c.json({ error: 'INVOICE_NOT_MATCHED', message: 'Invoice is not linked to a transaction' }, 409);
  }

  const txId = invoice.matched_transaction_id;
  await detachInvoiceTransaction(supabase, invoice_id, txId);
  // Send the invoice back to the ambiguous backlog instead of deleting it.
  await resetInvoiceToAmbiguous(supabase, invoice_id);

  return c.json({ rematched: { invoice_number: invoice.invoice_number, transaction_id: txId } });
});

// ─── GET /pwa/import/link-candidates ──────────────────────────────────────────
// Unlinked expense transactions near an invoice's date, for the manual-link picker.
// No amount filter (manual link is amount-agnostic); the client filters by note/item.

pwaRouter.get('/import/link-candidates', async (c) => {
  const dateParam = c.req.query('date');
  if (!dateParam) return c.json({ error: 'INVALID_PAYLOAD', message: 'date is required' }, 400);
  const invoiceDate = new Date(dateParam);
  if (isNaN(invoiceDate.getTime())) return c.json({ error: 'INVALID_PAYLOAD', message: 'invalid date' }, 400);
  const windowDays = Number(c.req.query('window')) || 7;
  const from = new Date(invoiceDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const to = new Date(invoiceDate.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const supabase = getSupabaseClient(c.env);
  const txs = await findTransactionsWithoutInvoiceInRange(supabase, from, to);

  const candidates = [];
  for (const tx of txs) {
    const items = await getTransactionItems(supabase, tx.id);
    candidates.push({
      id: tx.id,
      transaction_at: tx.transaction_at,
      amount: tx.amount,
      note: tx.note,
      tags: tx.tags,
      // `id` is exposed so the manual-link sheet can target an existing item for a
      // per-item rename (US3).
      items: items.map((it) => ({ id: it.id, name: it.name, amount: it.amount })),
    });
  }
  return c.json({ candidates });
});

// ─── POST /pwa/import/manual-link ─────────────────────────────────────────────
// Link an invoice to a user-chosen transaction, amount-agnostic. Two entry points:
//   • `invoice_id` — an already-persisted `ambiguous` invoice (its forex candidates
//     were wrong/empty); reuse the row and flip it to matched.
//   • `invoice` (+ `import_run_id`) — an unmatched invoice (FR-007: carried by the
//     client, not stored until now); persist it in a held state first.
// Then: append only the checked invoice line items (provenance-stamped; never deletes
// existing items), recompute effective amounts, and flip to matched LAST.

pwaRouter.post('/import/manual-link', async (c) => {
  interface Body {
    invoice_id?: string;
    invoice?: UnmatchedInvoiceDetail;
    import_run_id?: string;
    transaction_id: string;
    item_indexes?: number[];
    replace?: { item_id: string; invoice_item_index: number }[];
  }
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }
  const { invoice_id, invoice, import_run_id, transaction_id, item_indexes = [], replace = [] } = body;
  if (!transaction_id || (!invoice_id && !invoice)) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'transaction_id and one of invoice_id / invoice are required' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  // Resolve the invoice row: an existing ambiguous one, or insert the unmatched payload.
  let inv: Invoice;
  if (invoice_id) {
    const { data, error } = await supabase.from('invoices').select('*').eq('id', invoice_id).single();
    if (error || !data) return c.json({ error: 'NOT_FOUND', message: 'Invoice not found' }, 404);
    if (data.match_status !== 'ambiguous') {
      return c.json({ error: 'INVOICE_NOT_AMBIGUOUS', message: 'Invoice is not awaiting resolution' }, 409);
    }
    inv = data as Invoice;
  } else {
    if (!invoice?.invoice_number || !import_run_id) {
      return c.json({ error: 'INVALID_PAYLOAD', message: 'invoice.invoice_number and import_run_id are required' }, 400);
    }
    const existing = await findExistingInvoiceNumbers(supabase, [invoice.invoice_number]);
    if (existing.length > 0) {
      return c.json({ error: 'ALREADY_IMPORTED', message: 'Invoice already imported' }, 409);
    }
    const parsed: ParsedInvoice = { ...invoice, invoice_date: new Date(invoice.invoice_date) };
    // Persist in a valid transient state, flipped to `matched` last (ordered writes).
    // `ambiguous` is allowed by the match_status CHECK constraint and, on a mid-request
    // failure, lands the row in 待手動確認 (recoverable). Migration 023 also aligns the
    // column DEFAULT (formerly the constraint-invalid 'pending') with this value.
    inv = await insertInvoice(supabase, parsed, import_run_id, 'ambiguous');
  }

  const { data: tx, error: txErr } = await supabase
    .from('transactions').select('*').eq('id', transaction_id).single();
  if (txErr || !tx) return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404);
  if (tx.matched_invoice_id !== null) {
    return c.json({ error: 'TRANSACTION_ALREADY_LINKED', message: 'Transaction already linked to an invoice' }, 409);
  }

  const invoiceItems: InvoiceItem[] = inv.items ?? [];

  // US3: validate the optional per-item replace (rename) directives before any write —
  // each item_id must be on the chosen transaction and each invoice line index in range.
  if (replace.length > 0) {
    const existingItemIds = new Set((await getTransactionItems(supabase, tx.id)).map((i) => i.id));
    for (const r of replace) {
      if (!existingItemIds.has(r.item_id)) {
        return c.json({ error: 'INVALID_PAYLOAD', message: 'replace.item_id is not on the chosen transaction' }, 400);
      }
      if (r.invoice_item_index < 0 || r.invoice_item_index >= invoiceItems.length) {
        return c.json({ error: 'INVALID_PAYLOAD', message: 'replace.invoice_item_index is out of range' }, 400);
      }
    }
  }

  // Enrich the transaction.
  await enrichTransaction(supabase, tx.id, {
    invoiceNumber: inv.invoice_number,
    sellerName: inv.seller_name,
    sellerTaxId: inv.seller_tax_id,
    invoiceId: inv.id,
  });
  // US3: apply rename-only replaces — take the invoice line's name; the item keeps its
  // amount, effective_amount, tags, and source_invoice_id (NULL stays NULL, so a later
  // un-link won't delete a renamed user item).
  for (const r of replace) {
    await renameTransactionItem(supabase, r.item_id, invoiceItems[r.invoice_item_index].name);
  }
  // Append only the checked, positive-amount invoice items (provenance-stamped).
  const positive = invoiceItems
    .filter((_, idx) => item_indexes.includes(idx))
    .filter((li) => li.amount == null || li.amount > 0);
  if (positive.length > 0) {
    const base = (await getTransactionItems(supabase, tx.id)).length;
    await insertTransactionItems(supabase, tx.id, positive.map((li, i) => ({
      name: li.name, amount: li.amount, tags: [], sort_order: base + i, source_invoice_id: inv.id,
    })));
    await computeAndWriteEffectiveAmounts(supabase, tx.id, tx.amount as number);
  }
  // Flip invoice status to matched LAST.
  const confidence = computeConfidence(
    new Date(inv.invoice_date).toISOString(), tx.transaction_at, tx.amount, inv.net_amount
  );
  await linkInvoiceToTransaction(supabase, inv.id, tx.id, confidence);

  return c.json({
    resolved: {
      seller_name: inv.seller_name,
      invoice_number: inv.invoice_number,
      transaction_at: tx.transaction_at,
      amount: tx.amount,
      confidence,
      items_outcome: replace.length > 0 ? 'replaced' : positive.length > 0 ? 'filled' : 'kept',
    },
  });
});

// ─── GET /pwa/transactions/:id/adjustments ───────────────────────────────────

pwaRouter.get('/transactions/:id/adjustments', async (c) => {
  const txId = c.req.param('id');
  const supabase = getSupabaseClient(c.env);
  const adjustments = await getAdjustmentsForTransaction(supabase, txId);
  return c.json({ adjustments });
});

// ─── PUT /pwa/transactions/:id/adjustments ───────────────────────────────────
// Replaces all adjustments for a transaction, then recomputes effective_amount.

pwaRouter.put('/transactions/:id/adjustments', async (c) => {
  const txId = c.req.param('id');
  interface AdjInput { kind: 'fee' | 'refund' | 'discount'; amount: number; note?: string | null; basis?: 'percentage' | null; basis_value?: number | null }
  interface Body { adjustments: AdjInput[] }
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }

  const { adjustments } = body;
  for (const adj of adjustments) {
    if (!['fee', 'refund', 'discount'].includes(adj.kind)) {
      return c.json({ error: 'INVALID_ADJUSTMENT_KIND', message: 'adjustment kind must be fee, refund, or discount' }, 400);
    }
    if (!Number.isInteger(adj.amount) || adj.amount <= 0) {
      return c.json({ error: 'INVALID_ADJUSTMENT_AMOUNT', message: 'adjustment amount must be a positive integer' }, 400);
    }
    if (adj.basis != null && adj.basis !== 'percentage') {
      return c.json({ error: 'INVALID_ADJUSTMENT_BASIS', message: "basis must be 'percentage' or null" }, 400);
    }
    if (adj.basis_value != null && (!Number.isInteger(adj.basis_value) || adj.basis_value <= 0 || adj.basis_value > 100)) {
      return c.json({ error: 'INVALID_ADJUSTMENT_BASIS_VALUE', message: 'basis_value must be 1..100' }, 400);
    }
  }

  const supabase = getSupabaseClient(c.env);

  // Verify transaction exists and get its amount
  const { data: tx, error: txErr } = await supabase
    .from('transactions')
    .select('id, amount, transaction_at')
    .eq('id', txId)
    .single();
  if (txErr || !tx) return c.json({ error: 'NOT_FOUND', message: 'Transaction not found' }, 404);

  await deleteAdjustmentsForTransaction(supabase, txId);
  if (adjustments.length > 0) {
    await insertAdjustments(supabase, txId, adjustments.map((a) => ({ ...a, transaction_at: tx.transaction_at as string })));
  }
  await computeAndWriteEffectiveAmounts(supabase, txId, tx.amount as number);

  return c.json({ ok: true });
});

// ─── GET /pwa/budget ─────────────────────────────────────────────────────────

pwaRouter.get('/budget', async (c) => {
  const supabase = getSupabaseClient(c.env);
  const progress = await getBudgetProgress(supabase);
  return c.json({
    current_spend: progress.current_spend,
    monthly_budget: progress.monthly_budget,
    percentage: progress.percentage,
  });
});
