import { Hono } from 'hono';
import type { Env, PaymentMethod } from '../types';
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
  type TransactionForPeriod,
} from '../db/queries';
import { getBudgetProgress } from '../services/budget';
import { runImportPipeline } from '../services/invoice-matcher';
import { decodeCSVBuffer, parseCSVRows, groupInvoices, RowLimitError } from '../services/csv-parser';
import { aggregateByCategory, aggregateBySubcategory } from '../services/summary';

type PwaEnv = { Bindings: Env };

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'credit_card', 'easy_card', 'prepaid_wallet', 'bank_account'];

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
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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
  type AdjInput = { kind: 'fee' | 'refund' | 'discount'; amount: number; note?: string | null; basis?: 'percentage' | null; basis_value?: number | null };
  type Body = {
    amount: number;
    payment_method: string;
    category_tag?: string | null;
    free_tags?: string[];
    note?: string | null;
    items?: { name: string; amount?: number | null; tag?: string | null }[];
    adjustments?: AdjInput[];
  };
  let body: Body;
  try {
    body = await c.req.json<Body>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON' }, 400);
  }

  const { amount, payment_method, category_tag, free_tags: rawTags = [], note, items = [], adjustments = [] } = body;
  const free_tags = rawTags.map((t) => t.replace(/^[#\s]+|[#\s]+$/g, '')).filter(Boolean);

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
    tags: free_tags,
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
        tags: item.tag != null ? [item.tag] : category_tag != null ? [category_tag] : [],
        sort_order: i,
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
  const end = new Date(to + 'T23:59:59.999Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return c.json({ error: 'INVALID_DATE', message: 'from and to must be valid ISO dates' }, 400);
  }

  const supabase = getSupabaseClient(c.env);
  const txs = await getTransactionsForPeriod(supabase, start, end);
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

  const start = new Date(from);
  const end = new Date(to + 'T23:59:59.999Z');
  const supabase = getSupabaseClient(c.env);
  const txs = await getTransactionsForPeriod(supabase, start, end);
  const rawTotals = aggregateBySubcategory(enrichRefundTags(txs), major);
  const total = txs
    .filter((tx) => {
      const allTags = [...tx.tags, ...tx.transaction_items.flatMap((i) => i.tags)];
      return allTags.some((t) => t === major || t.startsWith(major + ':'));
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
    p_end: to + 'T23:59:59.999Z',
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

  const supabase = getSupabaseClient(c.env);
  const { data, error, count } = await supabase
    .from('transactions')
    .select(
      'id, amount, transaction_type, payment_method, tags, note, transaction_at, created_at, parent_transaction_id, transaction_items(id, name, amount, tags)',
      { count: 'exact' }
    )
    .gte('transaction_at', from)
    .lte('transaction_at', to + 'T23:59:59.999Z')
    .order('transaction_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  if (error) return c.json({ error: 'DB_ERROR', message: error.message }, 500);

  type TxRow = {
    id: string; amount: number; transaction_type: string; payment_method: string;
    tags: string[]; note: string | null; transaction_at: string; created_at: string; parent_transaction_id: string | null;
    transaction_items: { id: string; name: string; amount: number | null; tags: string[] }[];
  };
  let transactions = (data ?? []) as TxRow[];

  if (category) {
    const matchesCategory = (tags: string[]) =>
      tags.some((t) => t === category || t.startsWith(category + ':'));
    transactions = transactions.filter((tx) =>
      tx.transaction_items.some((item) => matchesCategory(item.tags)) ||
      matchesCategory(tx.tags)
    );
  }

  return c.json({
    total: count ?? 0,
    page,
    transactions: transactions.map(({ transaction_items, ...rest }) => ({ ...rest, items: transaction_items })),
  });
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
  type Body = { amount: number; description: string; parent_transaction_id?: string | null };
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
  type Body = { amount: number; description: string; payment_method: string; parent_transaction_id?: string | null };
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

  await insertTransactionItems(supabase, tx.id, [{ name: description || `退款`, amount, tags: parentCategoryTag ? [parentCategoryTag] : [] }]);

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

  const counters = await runImportPipeline(supabase, invoices, importRun.id, c.env, {
    voidedCount: skippedVoidedCount,
    zeroCount: skippedZeroCount,
    parseFailedCount,
  });

  await updateImportRun(supabase, importRun.id, {
    total_rows: counters.totalRows,
    matched_count: counters.matchedCount,
    auto_created_count: counters.autoCreatedCount,
    skipped_duplicate_count: counters.skippedDuplicateCount,
    skipped_voided_count: counters.skippedVoidedCount,
    held_forex_count: counters.heldForexCount,
    ambiguous_count: counters.ambiguousCount,
    parse_failed_count: counters.parseFailedCount,
  });

  return c.json({
    filename: file.name,
    matched_count: counters.matchedCount,
    auto_created_count: counters.autoCreatedCount,
    skipped_duplicate_count: counters.skippedDuplicateCount,
    held_forex_count: counters.heldForexCount,
    ambiguous_count: counters.ambiguousCount,
    skipped_voided_count: counters.skippedVoidedCount,
    parse_failed_count: counters.parseFailedCount,
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
  type AdjInput = { kind: 'fee' | 'refund' | 'discount'; amount: number; note?: string | null; basis?: 'percentage' | null; basis_value?: number | null };
  type Body = { adjustments: AdjInput[] };
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
