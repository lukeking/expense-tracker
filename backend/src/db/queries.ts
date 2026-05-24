import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transaction, Receipt, BudgetSettings, TransactionItem, PaymentMethod, MobileWallet, TransactionType, Invoice, ImportRun, ParsedInvoice, InvoiceMatchStatus, TransactionItemRow, TransactionAdjustment } from '../types';

export async function insertTransaction(
  supabase: SupabaseClient,
  data: {
    amount: number;
    items?: TransactionItem[] | null;
    tags: string[];
    payment_method: PaymentMethod;
    wallet?: MobileWallet | null;
    bank_name?: string | null;
    note?: string | null;
    discord_message_id?: string | null;
    transaction_type?: TransactionType;
    parent_transaction_id?: string | null;
    transaction_at: string;
  }
): Promise<Transaction> {
  const { items: _items, ...insertData } = data;
  const { data: row, error } = await supabase
    .from('transactions')
    .insert(insertData)
    .select()
    .single();
  if (error) throw new Error(`insertTransaction: ${error.message}`);
  return row as Transaction;
}

export async function insertTransactionItems(
  supabase: SupabaseClient,
  transactionId: string,
  items: { name: string; amount?: number | null; tags?: string[]; sort_order?: number }[]
): Promise<void> {
  if (items.length === 0) return;
  const rows = items.map((item, i) => {
    if (item.amount != null && item.amount <= 0) {
      throw new Error(`insertTransactionItems: item amount must be > 0, got ${item.amount}`);
    }
    return {
      transaction_id: transactionId,
      name: item.name,
      amount: item.amount ?? null,
      tags: item.tags ?? [],
      sort_order: item.sort_order ?? i,
    };
  });
  const { error } = await supabase.from('transaction_items').insert(rows);
  if (error) throw new Error(`insertTransactionItems: ${error.message}`);
}

export async function updateDiscordMessageId(
  supabase: SupabaseClient,
  transactionId: string,
  discordMessageId: string
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ discord_message_id: discordMessageId })
    .eq('id', transactionId);
  if (error) throw new Error(`updateDiscordMessageId: ${error.message}`);
}

export async function getMonthlySpend(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<number> {
  const start = `${year}-${String(month).padStart(2, '0')}-01T00:00:00+00:00`;
  const end =
    month === 12
      ? `${year + 1}-01-01T00:00:00+00:00`
      : `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00+00:00`;

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, transaction_type')
    .gte('transaction_at', start)
    .lt('transaction_at', end);

  if (error) throw new Error(`getMonthlySpend: ${error.message}`);
  return (data ?? []).reduce((sum, row) => {
    const amount = row.amount as number;
    return row.transaction_type === 'refund' ? sum - amount : sum + amount;
  }, 0);
}

export async function getBudgetSettings(supabase: SupabaseClient): Promise<BudgetSettings> {
  const { data, error } = await supabase
    .from('budget_settings')
    .select()
    .eq('id', 1)
    .single();
  if (error) throw new Error(`getBudgetSettings: ${error.message}`);
  return data as BudgetSettings;
}

export async function updateBudgetSettings(
  supabase: SupabaseClient,
  monthlyBudget: number
): Promise<void> {
  const { error } = await supabase
    .from('budget_settings')
    .update({ monthly_budget: monthlyBudget, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw new Error(`updateBudgetSettings: ${error.message}`);
}

export async function upsertReceipts(
  supabase: SupabaseClient,
  receipts: Omit<Receipt, 'id' | 'fetched_at' | 'created_at'>[]
): Promise<void> {
  if (receipts.length === 0) return;
  const { error } = await supabase
    .from('receipts')
    .upsert(receipts, { onConflict: 'invoice_number', ignoreDuplicates: true });
  if (error) throw new Error(`upsertReceipts: ${error.message}`);
}

export async function findMatchCandidates(
  supabase: SupabaseClient,
  amount: number,
  transactionAt: string
): Promise<Receipt[]> {
  const txDate = new Date(transactionAt);
  const windowStart = new Date(txDate.getTime() - 48 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const windowEnd = new Date(txDate.getTime() + 48 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from('receipts')
    .select('*')
    .eq('total_amount', amount)
    .gte('invoice_date', windowStart)
    .lte('invoice_date', windowEnd);

  if (error) throw new Error(`findMatchCandidates: ${error.message}`);
  return (data ?? []) as Receipt[];
}

export async function matchTransaction(
  supabase: SupabaseClient,
  transactionId: string,
  receiptId: string
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ is_matched: true, matched_receipt_id: receiptId })
    .eq('id', transactionId);
  if (error) throw new Error(`matchTransaction: ${error.message}`);
}

export async function getUnmatchedTransactions(supabase: SupabaseClient): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('is_matched', false);
  if (error) throw new Error(`getUnmatchedTransactions: ${error.message}`);
  return (data ?? []) as Transaction[];
}

export async function insertPendingMatch(
  supabase: SupabaseClient,
  transactionId: string,
  candidateIds: string[],
  discordMessageId?: string
): Promise<void> {
  const { error } = await supabase.from('pending_matches').insert({
    transaction_id: transactionId,
    candidate_ids: candidateIds,
    discord_message_id: discordMessageId ?? null,
  });
  if (error) throw new Error(`insertPendingMatch: ${error.message}`);
}

export async function resolvePendingMatch(
  supabase: SupabaseClient,
  transactionId: string
): Promise<void> {
  const { error } = await supabase
    .from('pending_matches')
    .update({ resolved: true })
    .eq('transaction_id', transactionId)
    .eq('resolved', false);
  if (error) throw new Error(`resolvePendingMatch: ${error.message}`);
}

export async function findParentCandidates(
  supabase: SupabaseClient,
  searchTerm: string,
  windowDays: number
): Promise<(Pick<Transaction, 'id' | 'amount' | 'note' | 'tags' | 'transaction_at'> & { transaction_items: { name: string }[] })[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  // PostgREST cannot filter on related table columns, so fetch all expense rows in the
  // window and filter in JS. At ~100 tx/month this is at most ~300 rows over 90 days.
  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, note, tags, transaction_at, transaction_items(name)')
    .eq('transaction_type', 'expense')
    .gte('transaction_at', since)
    .order('transaction_at', { ascending: false });
  if (error) throw new Error(`findParentCandidates: ${error.message}`);
  const lower = searchTerm.toLowerCase();
  const matches = (data ?? []).filter(
    (row) =>
      (row.transaction_items as { name: string }[])?.some((i) =>
        i.name.toLowerCase().includes(lower)
      ) ||
      (row.note ?? '').toLowerCase().includes(lower) ||
      (row.tags as string[])?.some((t) => t.toLowerCase().includes(lower))
  );
  return matches.slice(0, 5) as (Pick<Transaction, 'id' | 'amount' | 'note' | 'tags' | 'transaction_at'> & { transaction_items: { name: string }[] })[];
}

export async function updateParentTransactionId(
  supabase: SupabaseClient,
  transactionId: string,
  parentTransactionId: string
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ parent_transaction_id: parentTransactionId })
    .eq('id', transactionId);
  if (error) throw new Error(`updateParentTransactionId: ${error.message}`);
}

export async function findExistingTransaction(
  supabase: SupabaseClient,
  amount: number
): Promise<Transaction | null> {
  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('amount', amount)
    .gte('created_at', threeMinutesAgo)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`findExistingTransaction: ${error.message}`);
  return data && data.length > 0 ? (data[0] as Transaction) : null;
}

export async function amendTransactionAmount(
  supabase: SupabaseClient,
  txId: string,
  newAmount: number
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ amount: newAmount })
    .eq('id', txId);
  if (error) throw new Error(`amendTransactionAmount: ${error.message}`);
}

export async function createImportRun(
  supabase: SupabaseClient,
  fileName: string | null
): Promise<ImportRun> {
  const { data, error } = await supabase
    .from('import_runs')
    .insert({ file_name: fileName })
    .select()
    .single();
  if (error) throw new Error(`createImportRun: ${error.message}`);
  return data as ImportRun;
}

export async function updateImportRun(
  supabase: SupabaseClient,
  runId: string,
  counters: Partial<Omit<ImportRun, 'id' | 'file_name' | 'uploaded_at' | 'created_at'>>
): Promise<void> {
  const { error } = await supabase
    .from('import_runs')
    .update(counters)
    .eq('id', runId);
  if (error) throw new Error(`updateImportRun: ${error.message}`);
}

export async function findExistingInvoiceNumbers(
  supabase: SupabaseClient,
  invoiceNumbers: string[]
): Promise<string[]> {
  if (invoiceNumbers.length === 0) return [];
  const { data, error } = await supabase
    .from('invoices')
    .select('invoice_number')
    .in('invoice_number', invoiceNumbers);
  if (error) throw new Error(`findExistingInvoiceNumbers: ${error.message}`);
  return (data ?? []).map((r) => r.invoice_number as string);
}

export async function findMatchingExpenseTransaction(
  supabase: SupabaseClient,
  netAmount: number,
  invoiceDate: Date
): Promise<Transaction[]> {
  const windowStart = new Date(invoiceDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const windowEnd = new Date(invoiceDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('transaction_type', 'expense')
    .eq('amount', netAmount)
    .is('matched_invoice_id', null)
    .gte('transaction_at', windowStart)
    .lte('transaction_at', windowEnd + 'T23:59:59Z')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`findMatchingExpenseTransaction: ${error.message}`);
  return (data ?? []) as Transaction[];
}

export async function findExactMatchIncludingLinked(
  supabase: SupabaseClient,
  netAmount: number,
  invoiceDate: Date
): Promise<Transaction[]> {
  const windowStart = new Date(invoiceDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const windowEnd = new Date(invoiceDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('transaction_type', 'expense')
    .eq('amount', netAmount)
    .gte('transaction_at', windowStart)
    .lte('transaction_at', windowEnd + 'T23:59:59Z')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`findExactMatchIncludingLinked: ${error.message}`);
  return (data ?? []) as Transaction[];
}

export async function findForexCandidateTransaction(
  supabase: SupabaseClient,
  netAmount: number,
  invoiceDate: Date
): Promise<Transaction | null> {
  const windowStart = new Date(invoiceDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const windowEnd = new Date(invoiceDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const low = Math.floor(netAmount * 0.95);
  const high = Math.ceil(netAmount * 1.05);
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('transaction_type', 'expense')
    .is('matched_invoice_id', null)
    .gte('amount', low)
    .lte('amount', high)
    .gte('transaction_at', windowStart)
    .lte('transaction_at', windowEnd + 'T23:59:59Z')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`findForexCandidateTransaction: ${error.message}`);
  return data && data.length > 0 ? (data[0] as Transaction) : null;
}

export async function insertInvoice(
  supabase: SupabaseClient,
  invoice: ParsedInvoice,
  importRunId: string,
  matchStatus: InvoiceMatchStatus,
  matchedTxId?: string
): Promise<Invoice> {
  const { data, error } = await supabase
    .from('invoices')
    .insert({
      import_run_id: importRunId,
      invoice_number: invoice.invoice_number,
      seller_name: invoice.seller_name,
      seller_tax_id: invoice.seller_tax_id,
      invoice_date: invoice.invoice_date.toISOString().slice(0, 10),
      gross_amount: invoice.gross_amount,
      allowance: invoice.allowance,
      items: invoice.items.length > 0 ? invoice.items : null,
      invoice_status: invoice.invoice_status,
      match_status: matchStatus,
      matched_transaction_id: matchedTxId ?? null,
    })
    .select()
    .single();
  if (error) throw new Error(`insertInvoice: ${error.message}`);
  return data as Invoice;
}

export async function enrichTransaction(
  supabase: SupabaseClient,
  txId: string,
  fields: {
    invoiceNumber: string;
    sellerName: string | null;
    sellerTaxId: string | null;
    invoiceId: string;
  }
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({
      is_matched: true,
      invoice_number: fields.invoiceNumber,
      seller_name: fields.sellerName,
      seller_tax_id: fields.sellerTaxId,
      matched_invoice_id: fields.invoiceId,
    })
    .eq('id', txId);
  if (error) throw new Error(`enrichTransaction: ${error.message}`);
}

export async function findAllHeldForexInvoices(supabase: SupabaseClient): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('match_status', 'held_forex');
  if (error) throw new Error(`findAllHeldForexInvoices: ${error.message}`);
  return (data ?? []) as Invoice[];
}

export async function findAllAmbiguousInvoices(supabase: SupabaseClient): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('match_status', 'ambiguous')
    .order('invoice_date', { ascending: true });
  if (error) throw new Error(`findAllAmbiguousInvoices: ${error.message}`);
  return (data ?? []) as Invoice[];
}

export async function resolveHeldInvoice(
  supabase: SupabaseClient,
  invoiceId: string,
  txId: string,
  matchStatus: 'matched' | 'auto_created'
): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({ match_status: matchStatus, matched_transaction_id: txId })
    .eq('id', invoiceId);
  if (error) throw new Error(`resolveHeldInvoice: ${error.message}`);
}

export async function findTransactionsWithoutInvoiceInRange(
  supabase: SupabaseClient,
  from: Date,
  to: Date
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('transaction_type', 'expense')
    .is('matched_invoice_id', null)
    .gte('transaction_at', from.toISOString().slice(0, 10))
    .lte('transaction_at', to.toISOString().slice(0, 10) + 'T23:59:59Z')
    .order('transaction_at', { ascending: false });
  if (error) throw new Error(`findTransactionsWithoutInvoiceInRange: ${error.message}`);
  return (data ?? []) as Transaction[];
}

export type TransactionForPeriod = Pick<Transaction, 'id' | 'amount' | 'tags' | 'transaction_at' | 'transaction_type'> & {
  parent_transaction_id: string | null;
  transaction_items: { amount: number | null; effective_amount?: number | null; tags: string[] }[];
};

const PAGE_SIZE = 1000;

export async function getTransactionsForPeriod(
  supabase: SupabaseClient,
  start: Date,
  end: Date
): Promise<TransactionForPeriod[]> {
  const all: TransactionForPeriod[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, amount, transaction_type, tags, transaction_at, parent_transaction_id, transaction_items(amount, tags)')
      .in('transaction_type', ['expense', 'fee', 'refund'])
      .gte('transaction_at', start.toISOString())
      .lt('transaction_at', end.toISOString())
      .order('transaction_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`getTransactionsForPeriod: ${error.message}`);
    all.push(...((data ?? []) as TransactionForPeriod[]));
    if ((data ?? []).length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

export async function getCategoryTotals(
  supabase: SupabaseClient,
  start: Date,
  end: Date
): Promise<{ category: string; total: number }[]> {
  const { data, error } = await supabase.rpc('get_category_totals', {
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });
  if (error) throw new Error(`getCategoryTotals: ${error.message}`);
  return (data ?? []) as { category: string; total: number }[];
}

export async function getSubcategoryTotals(
  supabase: SupabaseClient,
  start: Date,
  end: Date,
  category: string
): Promise<{ subcategory: string; total: number }[]> {
  const { data, error } = await supabase.rpc('get_subcategory_totals', {
    p_start: start.toISOString(),
    p_end: end.toISOString(),
    p_category: category,
  });
  if (error) throw new Error(`getSubcategoryTotals: ${error.message}`);
  return (data ?? []) as { subcategory: string; total: number }[];
}

export async function getTransactionWithItems(
  supabase: SupabaseClient,
  txId: string
): Promise<{ amount: number; note: string | null; transaction_items: Pick<TransactionItemRow, 'id' | 'name' | 'amount'>[] } | null> {
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, note, transaction_items(id, name, amount)')
    .eq('id', txId)
    .single();
  if (error) throw new Error(`getTransactionWithItems: ${error.message}`);
  return data as { amount: number; note: string | null; transaction_items: Pick<TransactionItemRow, 'id' | 'name' | 'amount'>[] } | null;
}

export async function updateTransactionItemAmount(
  supabase: SupabaseClient,
  itemId: string,
  newAmount: number
): Promise<void> {
  const { error } = await supabase
    .from('transaction_items')
    .update({ amount: newAmount })
    .eq('id', itemId);
  if (error) throw new Error(`updateTransactionItemAmount: ${error.message}`);
}

export async function getTransactionItems(
  supabase: SupabaseClient,
  transactionId: string
): Promise<TransactionItemRow[]> {
  const { data, error } = await supabase
    .from('transaction_items')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`getTransactionItems: ${error.message}`);
  return (data ?? []) as TransactionItemRow[];
}

export async function replaceTransactionItems(
  supabase: SupabaseClient,
  transactionId: string,
  items: { name: string; amount?: number | null; tags?: string[]; sort_order?: number }[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('transaction_items')
    .delete()
    .eq('transaction_id', transactionId);
  if (deleteError) throw new Error(`replaceTransactionItems delete: ${deleteError.message}`);
  await insertTransactionItems(supabase, transactionId, items);
}

export async function mergeTransactionFields(
  supabase: SupabaseClient,
  transactionId: string,
  fields: { bank_name?: string | null; wallet?: MobileWallet | null }
): Promise<Transaction> {
  // Only update fields that are currently null in the DB
  const updates: Record<string, string | null> = {};
  if (fields.bank_name != null) updates.bank_name = fields.bank_name;
  if (fields.wallet != null) updates.wallet = fields.wallet;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', transactionId)
      .is('bank_name', null); // only overwrite if still null (first writer wins per field)
    if (error) throw new Error(`mergeTransactionFields: ${error.message}`);
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', transactionId)
    .single();
  if (error) throw new Error(`mergeTransactionFields fetch: ${error.message}`);
  return data as Transaction;
}

export async function insertAdjustments(
  supabase: SupabaseClient,
  transactionId: string,
  adjustments: { kind: 'fee' | 'refund' | 'discount'; amount: number; note?: string | null; transaction_at?: string; source?: string; basis?: string | null; basis_value?: number | null }[]
): Promise<void> {
  if (adjustments.length === 0) return;
  const now = new Date().toISOString();
  const rows = adjustments.map((a) => ({
    transaction_id: transactionId,
    kind: a.kind,
    amount: a.amount,
    note: a.note ?? null,
    transaction_at: a.transaction_at ?? now,
    source: a.source ?? 'manual',
    basis: a.basis ?? null,
    basis_value: a.basis_value ?? null,
  }));
  const { error } = await supabase.from('transaction_adjustments').insert(rows);
  if (error) throw new Error(`insertAdjustments: ${error.message}`);
}

export async function computeAndWriteEffectiveAmounts(
  supabase: SupabaseClient,
  transactionId: string,
  paidTotal: number
): Promise<void> {
  const { data, error } = await supabase
    .from('transaction_items')
    .select('id, amount, sort_order')
    .eq('transaction_id', transactionId)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`computeAndWriteEffectiveAmounts fetch: ${error.message}`);

  const items = (data ?? []) as { id: string; amount: number | null; sort_order: number }[];
  const eligible = items.filter((i) => i.amount != null);
  if (eligible.length === 0) return;

  const itemsTotal = eligible.reduce((s, i) => s + i.amount!, 0);
  if (itemsTotal === 0) return;

  const shares = eligible.map((i) => ({ id: i.id, amount: i.amount!, ea: Math.floor(i.amount! * paidTotal / itemsTotal) }));
  const remainder = paidTotal - shares.reduce((s, x) => s + x.ea, 0);

  // Add remainder to item with largest amount; ties go to last by sort_order (already ordered ascending, so last is highest index)
  const maxAmount = Math.max(...shares.map((s) => s.amount));
  const largestIdx = shares.reduce((bestIdx, s, idx) => (s.amount >= maxAmount ? idx : bestIdx), 0);
  shares[largestIdx].ea += remainder;

  for (const s of shares) {
    const { error: updateErr } = await supabase
      .from('transaction_items')
      .update({ effective_amount: s.ea })
      .eq('id', s.id);
    if (updateErr) throw new Error(`computeAndWriteEffectiveAmounts update: ${updateErr.message}`);
  }
}

export async function getAdjustmentsForTransaction(
  supabase: SupabaseClient,
  transactionId: string
): Promise<TransactionAdjustment[]> {
  const { data, error } = await supabase
    .from('transaction_adjustments')
    .select('*')
    .eq('transaction_id', transactionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`getAdjustmentsForTransaction: ${error.message}`);
  return (data ?? []) as TransactionAdjustment[];
}

export async function deleteAdjustmentsForTransaction(
  supabase: SupabaseClient,
  transactionId: string
): Promise<void> {
  const { error } = await supabase
    .from('transaction_adjustments')
    .delete()
    .eq('transaction_id', transactionId);
  if (error) throw new Error(`deleteAdjustmentsForTransaction: ${error.message}`);
}
