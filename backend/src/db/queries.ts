import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transaction, Receipt, BudgetSettings, TransactionItem, PaymentMethod, MobileWallet, TransactionType, Invoice, ImportRun, ParsedInvoice, InvoiceMatchStatus, MatchConfidence, TransactionItemRow, TransactionAdjustment, InvoiceItem } from '../types';

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
  items: { name: string; amount?: number | null; tags?: string[]; sort_order?: number; note?: string | null; source_invoice_id?: string | null }[]
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
      note: item.note ?? null,
      source_invoice_id: item.source_invoice_id ?? null,
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

/**
 * Does a candidate transaction match a parent-search term?
 *
 * Matches against every place a human label can live: item names, item-level
 * tags (where a `#category:sub` "shared category" tag lands — e.g. iherb),
 * the transaction note, and transaction-level plain tags. Pure so it can be
 * unit-tested without a DB.
 */
export function transactionMatchesParentSearch(
  row: {
    note: string | null;
    tags: string[] | null;
    transaction_items: { name: string; tags?: string[] | null }[] | null;
  },
  searchTerm: string
): boolean {
  const lower = searchTerm.toLowerCase();
  const items = row.transaction_items ?? [];
  return (
    items.some((i) => i.name.toLowerCase().includes(lower)) ||
    items.some((i) => (i.tags ?? []).some((t) => t.toLowerCase().includes(lower))) ||
    (row.note ?? '').toLowerCase().includes(lower) ||
    (row.tags ?? []).some((t) => t.toLowerCase().includes(lower))
  );
}

export async function findParentCandidates(
  supabase: SupabaseClient,
  searchTerm: string,
  windowDays: number,
  excludeId?: string
): Promise<(Pick<Transaction, 'id' | 'amount' | 'note' | 'tags' | 'transaction_at'> & { transaction_items: { name: string }[] })[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  // Include `fee` rows, not just `expense`: a refund can reverse part of an earlier
  // fee (e.g. a tax-exempt 國外交易服務費 partial refund), so the fee must be linkable
  // as a parent. (Refund rows are intentionally excluded — a refund is never a parent.)
  // PostgREST cannot filter on related table columns, so fetch all candidate rows in the
  // window and filter in JS. At ~100 tx/month this is at most ~300 rows over 90 days.
  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, note, tags, transaction_at, transaction_items(name, tags)')
    .in('transaction_type', ['expense', 'fee'])
    .gte('transaction_at', since)
    .order('transaction_at', { ascending: false });
  if (error) throw new Error(`findParentCandidates: ${error.message}`);
  const matches = (data ?? []).filter(
    (row) =>
      row.id !== excludeId &&
      transactionMatchesParentSearch(
        row as {
          note: string | null;
          tags: string[] | null;
          transaction_items: { name: string; tags?: string[] | null }[] | null;
        },
        searchTerm
      )
  );
  return matches.slice(0, 5) as (Pick<Transaction, 'id' | 'amount' | 'note' | 'tags' | 'transaction_at'> & { transaction_items: { name: string }[] })[];
}

/**
 * Merge a parent transaction's tags into a child's, de-duplicated and
 * preserving the child's own tags. Pure so it can be unit-tested without a DB.
 */
export function mergeParentTags(childTags: string[] | null, parentTags: string[] | null): string[] {
  return Array.from(new Set([...(childTags ?? []), ...(parentTags ?? [])]));
}

export async function updateParentTransactionId(
  supabase: SupabaseClient,
  transactionId: string,
  parentTransactionId: string
): Promise<void> {
  // Inherit the parent's transaction-level tags onto the linked fee/refund so the
  // whole group (e.g. an iherb purchase + its 國外交易服務費 + a partial refund) is
  // findable by the same tag — not just by the child's note/description. Merge into
  // any tags the child already carries; never drop the child's own.
  const [parentRes, childRes] = await Promise.all([
    supabase.from('transactions').select('tags').eq('id', parentTransactionId).single(),
    supabase.from('transactions').select('tags').eq('id', transactionId).single(),
  ]);
  if (parentRes.error) throw new Error(`updateParentTransactionId(parent): ${parentRes.error.message}`);
  if (childRes.error) throw new Error(`updateParentTransactionId(child): ${childRes.error.message}`);
  const mergedTags = mergeParentTags(
    (childRes.data?.tags as string[] | null) ?? null,
    (parentRes.data?.tags as string[] | null) ?? null
  );

  const { error } = await supabase
    .from('transactions')
    .update({ parent_transaction_id: parentTransactionId, tags: mergedTags })
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

// ─── Invoice Import — bulk pipeline (feature 024) ─────────────────────────────
// These collapse the per-invoice query loop into a constant number of round-trips so
// a single import stays under the Cloudflare Workers subrequest cap. Matching itself
// runs in memory (see invoice-matcher.ts) against the rows fetched here.

// Supabase/PostgREST returns at most this many rows in one response. The candidate
// fetch requests one more than this and aborts on overflow rather than silently
// matching a truncated set (FR-012).
export const IMPORT_CANDIDATE_PAGE_LIMIT = 1000;

// One query for every unmatched expense transaction in the import's union date window.
// Amount is NOT bounded here (each invoice has a different net) — amount filtering happens
// in memory. `windowEndInclusiveISO` should already carry the end-of-day suffix.
export async function fetchImportCandidateTransactions(
  supabase: SupabaseClient,
  windowStartISO: string,
  windowEndInclusiveISO: string
): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('transaction_type', 'expense')
    .is('matched_invoice_id', null)
    .gte('transaction_at', windowStartISO)
    .lte('transaction_at', windowEndInclusiveISO)
    .order('created_at', { ascending: false })
    .limit(IMPORT_CANDIDATE_PAGE_LIMIT + 1);
  if (error) throw new Error(`fetchImportCandidateTransactions: ${error.message}`);
  const rows = (data ?? []) as Transaction[];
  if (rows.length > IMPORT_CANDIDATE_PAGE_LIMIT) {
    throw new Error(
      `fetchImportCandidateTransactions: candidate window returned more than ${IMPORT_CANDIDATE_PAGE_LIMIT} ` +
        `transactions; import aborted to avoid matching against a truncated set. Split the import by date range.`
    );
  }
  return rows;
}

// One query summing `discount`-kind adjustments per transaction (fees/refunds excluded,
// matching US2). Returns an empty map for an empty id list (no round-trip).
export async function fetchDiscountSumsByTransaction(
  supabase: SupabaseClient,
  txIds: string[]
): Promise<Map<string, number>> {
  const sums = new Map<string, number>();
  if (txIds.length === 0) return sums;
  const { data, error } = await supabase
    .from('transaction_adjustments')
    .select('transaction_id, amount')
    .in('transaction_id', txIds)
    .eq('kind', 'discount');
  if (error) throw new Error(`fetchDiscountSumsByTransaction: ${error.message}`);
  for (const a of (data ?? []) as { transaction_id: string; amount: number }[]) {
    sums.set(a.transaction_id, (sums.get(a.transaction_id) ?? 0) + a.amount);
  }
  return sums;
}

// Row shape for a bulk invoice insert (mirrors insertInvoice's column set; `net_amount`
// is a generated column and is intentionally omitted).
export interface InvoiceInsertRow {
  import_run_id: string;
  invoice_number: string;
  seller_name: string | null;
  seller_tax_id: string | null;
  invoice_date: string;
  gross_amount: number;
  allowance: number;
  items: InvoiceItem[] | null;
  invoice_status: 'active' | 'voided';
  match_status: InvoiceMatchStatus;
  match_confidence: MatchConfidence | null;
  matched_transaction_id: string | null;
}

// One multi-row insert; returns the inserted rows (with ids) so the caller can map each
// invoice's new id back to its matched transaction / filled items.
export async function bulkInsertInvoices(
  supabase: SupabaseClient,
  rows: InvoiceInsertRow[]
): Promise<Invoice[]> {
  if (rows.length === 0) return [];
  const { data, error } = await supabase.from('invoices').insert(rows).select();
  if (error) throw new Error(`bulkInsertInvoices: ${error.message}`);
  return (data ?? []) as Invoice[];
}

// One upsert (onConflict `id`) that enriches every matched transaction at once. Rows are
// the full pre-fetched transaction rows merged with the enrichment fields, so the ON
// CONFLICT path updates existing rows without inserting anything new (SC-003).
export async function bulkEnrichTransactions(
  supabase: SupabaseClient,
  rows: Transaction[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('transactions').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error(`bulkEnrichTransactions: ${error.message}`);
}

// One multi-row insert for all filled items across the whole import. Each row already
// carries its `transaction_id` and `source_invoice_id`.
export async function bulkInsertTransactionItems(
  supabase: SupabaseClient,
  rows: { transaction_id: string; name: string; amount: number | null; effective_amount?: number | null; tags: string[]; sort_order: number; source_invoice_id: string | null }[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('transaction_items').insert(rows);
  if (error) throw new Error(`bulkInsertTransactionItems: ${error.message}`);
}

export async function insertInvoice(
  supabase: SupabaseClient,
  invoice: ParsedInvoice,
  importRunId: string,
  matchStatus: InvoiceMatchStatus,
  matchedTxId?: string,
  confidence?: MatchConfidence
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
      match_confidence: confidence ?? null,
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

// Inverse of enrichTransaction: detach an invoice from a transaction. `isMatched`
// is passed by the caller so a transaction still linked to a receipt stays matched.
export async function clearTransactionInvoiceLink(
  supabase: SupabaseClient,
  txId: string,
  isMatched: boolean
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({
      is_matched: isMatched,
      invoice_number: null,
      seller_name: null,
      seller_tax_id: null,
      matched_invoice_id: null,
    })
    .eq('id', txId);
  if (error) throw new Error(`clearTransactionInvoiceLink: ${error.message}`);
}

// US1: the review queue shows unacknowledged matches by default; `includeRead` reveals
// acknowledged ones for the 顯示已讀 toggle.
export async function findAllMatchedInvoices(
  supabase: SupabaseClient,
  includeRead = false
): Promise<Invoice[]> {
  let query = supabase
    .from('invoices')
    .select('*')
    .eq('match_status', 'matched');
  if (!includeRead) query = query.is('reviewed_at', null);
  const { data, error } = await query.order('invoice_date', { ascending: false });
  if (error) throw new Error(`findAllMatchedInvoices: ${error.message}`);
  return (data ?? []) as Invoice[];
}

// US1: acknowledge ("mark as read") matched invoices. Only `matched` rows are
// acknowledgeable; returns how many rows were affected.
export async function markInvoicesRead(
  supabase: SupabaseClient,
  invoiceIds: string[]
): Promise<number> {
  if (invoiceIds.length === 0) return 0;
  const { data, error } = await supabase
    .from('invoices')
    .update({ reviewed_at: new Date().toISOString() })
    .eq('match_status', 'matched')
    .in('id', invoiceIds)
    .select('id');
  if (error) throw new Error(`markInvoicesRead: ${error.message}`);
  return (data ?? []).length;
}

// US1: batched fetch of linked transactions for the matched-invoice list (replaces
// the per-invoice N+1).
export async function getTransactionsByIds(
  supabase: SupabaseClient,
  ids: string[]
): Promise<Pick<Transaction, 'id' | 'amount' | 'transaction_at' | 'note' | 'tags'>[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, transaction_at, note, tags')
    .in('id', ids);
  if (error) throw new Error(`getTransactionsByIds: ${error.message}`);
  return (data ?? []) as Pick<Transaction, 'id' | 'amount' | 'transaction_at' | 'note' | 'tags'>[];
}

// Batched fetch of items for a set of transactions (one query for the whole matched
// list, keeping the review screen free of per-row round-trips).
export async function getTransactionItemsByTransactionIds(
  supabase: SupabaseClient,
  txIds: string[]
): Promise<Pick<TransactionItemRow, 'transaction_id' | 'name' | 'amount' | 'tags' | 'sort_order'>[]> {
  if (txIds.length === 0) return [];
  const { data, error } = await supabase
    .from('transaction_items')
    .select('transaction_id, name, amount, tags, sort_order')
    .in('transaction_id', txIds)
    .order('sort_order', { ascending: true });
  if (error) throw new Error(`getTransactionItemsByTransactionIds: ${error.message}`);
  return (data ?? []) as Pick<TransactionItemRow, 'transaction_id' | 'name' | 'amount' | 'tags' | 'sort_order'>[];
}

export async function deleteInvoice(supabase: SupabaseClient, invoiceId: string): Promise<void> {
  const { error } = await supabase.from('invoices').delete().eq('id', invoiceId);
  if (error) throw new Error(`deleteInvoice: ${error.message}`);
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

export async function linkInvoiceToTransaction(
  supabase: SupabaseClient,
  invoiceId: string,
  txId: string,
  confidence: MatchConfidence
): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({ match_status: 'matched', match_confidence: confidence, matched_transaction_id: txId })
    .eq('id', invoiceId);
  if (error) throw new Error(`linkInvoiceToTransaction: ${error.message}`);
}

// Inverse of linkInvoiceToTransaction: send a matched invoice back to the `ambiguous`
// backlog (for 改配對) instead of deleting it, so it can be re-linked without re-import.
export async function resetInvoiceToAmbiguous(
  supabase: SupabaseClient,
  invoiceId: string
): Promise<void> {
  const { error } = await supabase
    .from('invoices')
    .update({ match_status: 'ambiguous', matched_transaction_id: null, match_confidence: null, reviewed_at: null })
    .eq('id', invoiceId);
  if (error) throw new Error(`resetInvoiceToAmbiguous: ${error.message}`);
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
    .lte('transaction_at', `${to.toISOString().slice(0, 10)}T23:59:59Z`)
    .order('transaction_at', { ascending: false });
  if (error) throw new Error(`findTransactionsWithoutInvoiceInRange: ${error.message}`);
  return (data ?? []) as Transaction[];
}

export type TransactionForPeriod = Pick<Transaction, 'id' | 'amount' | 'tags' | 'transaction_at' | 'transaction_type' | 'payment_method'> & {
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
      .select('id, amount, transaction_type, payment_method, tags, transaction_at, parent_transaction_id, transaction_items(amount, effective_amount, tags)')
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

// US3: rename-only per-item replace — update just the item's display name; amount,
// effective_amount, tags, and source_invoice_id are left untouched.
export async function renameTransactionItem(
  supabase: SupabaseClient,
  itemId: string,
  name: string
): Promise<void> {
  const { error } = await supabase
    .from('transaction_items')
    .update({ name })
    .eq('id', itemId);
  if (error) throw new Error(`renameTransactionItem: ${error.message}`);
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
  items: { name: string; amount?: number | null; tags?: string[]; sort_order?: number; note?: string | null }[]
): Promise<void> {
  const { error: deleteError } = await supabase
    .from('transaction_items')
    .delete()
    .eq('transaction_id', transactionId);
  if (deleteError) throw new Error(`replaceTransactionItems delete: ${deleteError.message}`);
  await insertTransactionItems(supabase, transactionId, items);
}

// Removes only the items created by linking a given invoice (by provenance), so a
// transaction's own user-entered items always survive an unlink.
export async function deleteTransactionItemsBySourceInvoice(
  supabase: SupabaseClient,
  transactionId: string,
  invoiceId: string
): Promise<void> {
  const { error } = await supabase
    .from('transaction_items')
    .delete()
    .eq('transaction_id', transactionId)
    .eq('source_invoice_id', invoiceId);
  if (error) throw new Error(`deleteTransactionItemsBySourceInvoice: ${error.message}`);
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

// Pure: distribute `paidTotal` across items proportional to each item's face `amount`,
// flooring each share and adding the rounding remainder to the largest-amount item (ties
// resolved to the last in the given order — callers pass items in sort_order). Items with
// `amount == null` get no share (excluded). The returned shares sum exactly to `paidTotal`.
// Single source of truth for both the per-tx DB writer and the bulk import pipeline.
export function computeEffectiveShares(
  items: { id: string; amount: number | null }[],
  paidTotal: number
): Map<string, number> {
  const result = new Map<string, number>();
  const eligible = items.filter((i) => i.amount != null) as { id: string; amount: number }[];
  if (eligible.length === 0) return result;

  const itemsTotal = eligible.reduce((s, i) => s + i.amount, 0);
  if (itemsTotal === 0) return result;

  const shares = eligible.map((i) => ({ id: i.id, amount: i.amount, ea: Math.floor(i.amount * paidTotal / itemsTotal) }));
  const remainder = paidTotal - shares.reduce((s, x) => s + x.ea, 0);

  const maxAmount = Math.max(...shares.map((s) => s.amount));
  const largestIdx = shares.reduce((bestIdx, s, idx) => (s.amount >= maxAmount ? idx : bestIdx), 0);
  shares[largestIdx].ea += remainder;

  for (const s of shares) result.set(s.id, s.ea);
  return result;
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
  const shares = computeEffectiveShares(items, paidTotal);
  if (shares.size === 0) return;

  for (const [id, ea] of shares) {
    const { error: updateErr } = await supabase
      .from('transaction_items')
      .update({ effective_amount: ea })
      .eq('id', id);
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
