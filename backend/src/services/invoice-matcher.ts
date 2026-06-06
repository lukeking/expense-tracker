import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedInvoice, InvoiceItem, MatchConfidence, ItemsOutcome, MatchedInvoiceDetail, UnmatchedInvoiceDetail, Transaction } from '../types';
import {
  findExistingInvoiceNumbers,
  fetchImportCandidateTransactions,
  fetchDiscountSumsByTransaction,
  bulkInsertInvoices,
  bulkEnrichTransactions,
  bulkInsertTransactionItems,
  getTransactionItems,
  getTransactionItemsByTransactionIds,
  insertTransactionItems,
  replaceTransactionItems,
  computeEffectiveShares,
  type InvoiceInsertRow,
} from '../db/queries';

// Invoice Import v2 — enrichment only. The pipeline NEVER creates transactions
// (FR-005). It auto-links an invoice only when exactly one in-window candidate exists
// within ±2 days — a candidate being a transaction whose paid amount OR whose gross
// (paid + recorded discounts, US2) equals the invoice net amount. ≥2 such candidates,
// or (when none exists) any ±5%/±7-day forex candidate, are held `ambiguous` for manual
// resolution.
//
// Feature 024: to stay under the Cloudflare Workers subrequest cap, all candidate reads
// are pre-fetched once and matching runs in memory; all writes are bulk. The matching
// rules are unchanged — `selectExactDiscountCandidates` / `selectForexCandidates` encode
// exactly the same windows/amount math the per-invoice DB queries used.

export interface PipelineCounters {
  matchedExact: number;
  matchedNear: number;
  ambiguous: number;
  skippedUnmatched: number;
  skippedDuplicate: number;
  skippedVoided: number;
  skippedZero: number;
  parseFailed: number;
  matched: MatchedInvoiceDetail[];
  skippedUnmatchedDetail: UnmatchedInvoiceDetail[];
}

// `exact` requires the matched transaction to be on the same calendar day AND have
// the exact net amount; every other linked match is `near` (FR-004).
export function computeConfidence(
  invoiceDateISO: string,
  txTransactionAt: string,
  txAmount: number,
  netAmount: number
): MatchConfidence {
  const sameDay = invoiceDateISO.slice(0, 10) === txTransactionAt.slice(0, 10);
  return sameDay && txAmount === netAmount ? 'exact' : 'near';
}

// ─── In-memory matchers (pure) ────────────────────────────────────────────────
// These run against the pre-fetched candidate pool and apply the exact match rules
// (±2-day discount-aware exact, ±7-day ±5% forex) with no further DB round-trips.

function dayOffsetDateISO(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Lexicographic compare is equivalent to timestamp compare for Z-normalized ISO strings,
// matching the gte/lte the DB queries applied to `transaction_at`.
function inWindow(txAt: string, startISO: string, endInclusiveISO: string): boolean {
  return txAt >= startISO && txAt <= endInclusiveISO;
}

// ±2-day window; paid amount == net OR paid + Σdiscount == net (discounts only ever raise
// the gross). Mirrors the `amount <= net` bound + discount-aware filter of the DB query.
export function selectExactDiscountCandidates(
  netAmount: number,
  invoiceDate: Date,
  candidates: Transaction[],
  discountByTxId: Map<string, number>,
  consumedTxIds: Set<string>
): Transaction[] {
  const start = dayOffsetDateISO(invoiceDate, -2);
  const endInclusive = `${dayOffsetDateISO(invoiceDate, 2)}T23:59:59Z`;
  return candidates.filter(
    (t) =>
      !consumedTxIds.has(t.id) &&
      t.amount <= netAmount &&
      inWindow(t.transaction_at, start, endInclusive) &&
      (t.amount === netAmount || t.amount + (discountByTxId.get(t.id) ?? 0) === netAmount)
  );
}

// ±7-day window; floor(net*0.95)..ceil(net*1.05). Never auto-linked — only surfaces for
// manual resolution. Mirrors the forex DB query.
export function selectForexCandidates(
  netAmount: number,
  invoiceDate: Date,
  candidates: Transaction[],
  consumedTxIds: Set<string>
): Transaction[] {
  const start = dayOffsetDateISO(invoiceDate, -7);
  const endInclusive = `${dayOffsetDateISO(invoiceDate, 7)}T23:59:59Z`;
  const low = Math.floor(netAmount * 0.95);
  const high = Math.ceil(netAmount * 1.05);
  return candidates.filter(
    (t) =>
      !consumedTxIds.has(t.id) &&
      t.amount >= low &&
      t.amount <= high &&
      inWindow(t.transaction_at, start, endInclusive)
  );
}

function buildInvoiceRow(
  invoice: ParsedInvoice,
  importRunId: string,
  matchStatus: 'matched' | 'ambiguous',
  matchedTxId: string | null,
  confidence: MatchConfidence | null
): InvoiceInsertRow {
  return {
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
    match_confidence: confidence,
    matched_transaction_id: matchedTxId,
  };
}

// Items rule (FR-008/009): on replace, swap existing items for the invoice's
// positive-amount line items (`replaced`); otherwise fill only when the transaction
// has no items (`filled`), else leave them untouched (`kept`). Kept for the manual
// link / resolve handlers; the bulk pipeline inlines the same rule for batching.
export async function applyInvoiceItems(
  supabase: SupabaseClient,
  transactionId: string,
  invoiceLineItems: InvoiceItem[],
  replace: boolean,
  invoiceId: string
): Promise<ItemsOutcome> {
  const positiveItems = invoiceLineItems.filter((li) => li.amount == null || li.amount > 0);
  const mapItems = () =>
    positiveItems.map((li, idx) => ({ name: li.name, amount: li.amount, tags: [] as string[], sort_order: idx, source_invoice_id: invoiceId }));

  if (replace) {
    await replaceTransactionItems(supabase, transactionId, mapItems());
    return 'replaced';
  }

  const existing = await getTransactionItems(supabase, transactionId);
  if (existing.length > 0) return 'kept';
  if (positiveItems.length > 0) {
    await insertTransactionItems(supabase, transactionId, mapItems());
  }
  return 'filled';
}

export async function runImportPipeline(
  supabase: SupabaseClient,
  invoices: ParsedInvoice[],
  importRunId: string,
  initialSkipped: { voidedCount: number; zeroCount: number; parseFailedCount: number }
): Promise<PipelineCounters> {
  const counters: PipelineCounters = {
    matchedExact: 0,
    matchedNear: 0,
    ambiguous: 0,
    skippedUnmatched: 0,
    skippedDuplicate: 0,
    skippedVoided: initialSkipped.voidedCount,
    skippedZero: initialSkipped.zeroCount,
    parseFailed: initialSkipped.parseFailedCount,
    matched: [],
    skippedUnmatchedDetail: [],
  };

  // Dedup by invoice_number before any matching (FR-001).
  const existingNumbers = new Set(
    await findExistingInvoiceNumbers(supabase, invoices.map((i) => i.invoice_number))
  );
  const toProcess: ParsedInvoice[] = [];
  for (const invoice of invoices) {
    if (existingNumbers.has(invoice.invoice_number)) counters.skippedDuplicate++;
    else toProcess.push(invoice);
  }
  if (toProcess.length === 0) return counters;

  // One candidate fetch over the union window: earliest invoice − 7d … latest invoice + 7d
  // covers both the ±2-day exact/discount window and the ±7-day forex window.
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const inv of toProcess) {
    const t = inv.invoice_date.getTime();
    if (t < minTime) minTime = t;
    if (t > maxTime) maxTime = t;
  }
  const windowStart = dayOffsetDateISO(new Date(minTime), -7);
  const windowEndInclusive = `${dayOffsetDateISO(new Date(maxTime), 7)}T23:59:59Z`;
  const candidates = await fetchImportCandidateTransactions(supabase, windowStart, windowEndInclusive);

  // Discounts can only matter for candidates paid below the largest net in the batch.
  const maxNet = Math.max(...toProcess.map((i) => i.net_amount));
  const belowNetIds = candidates.filter((t) => t.amount < maxNet).map((t) => t.id);
  const discountByTx = await fetchDiscountSumsByTransaction(supabase, belowNetIds);

  // Match in input order; a linked transaction is consumed so it can't link twice in the
  // same run (FR-005/SC-005) — reproduces the DB `matched_invoice_id IS NULL` exclusion.
  const consumed = new Set<string>();
  const matchedEntries: { invoice: ParsedInvoice; tx: Transaction; confidence: MatchConfidence }[] = [];
  const ambiguousInvoices: ParsedInvoice[] = [];

  for (const invoice of toProcess) {
    const exact = selectExactDiscountCandidates(invoice.net_amount, invoice.invoice_date, candidates, discountByTx, consumed);
    if (exact.length === 1) {
      const tx = exact[0];
      consumed.add(tx.id);
      const confidence = computeConfidence(invoice.invoice_date.toISOString(), tx.transaction_at, tx.amount, invoice.net_amount);
      matchedEntries.push({ invoice, tx, confidence });
    } else if (exact.length >= 2) {
      ambiguousInvoices.push(invoice);
    } else {
      const forex = selectForexCandidates(invoice.net_amount, invoice.invoice_date, candidates, consumed);
      if (forex.length >= 1) {
        ambiguousInvoices.push(invoice);
      } else {
        // Zero candidates — counted only; no invoice row persisted (FR-007), so a later
        // import can retry once a matching transaction exists. The detail is surfaced in
        // the response so the user can see which invoices didn't match.
        counters.skippedUnmatched++;
        counters.skippedUnmatchedDetail.push({
          invoice_number: invoice.invoice_number,
          seller_name: invoice.seller_name,
          seller_tax_id: invoice.seller_tax_id,
          invoice_date: invoice.invoice_date.toISOString(),
          gross_amount: invoice.gross_amount,
          allowance: invoice.allowance,
          net_amount: invoice.net_amount,
          invoice_status: invoice.invoice_status,
          items: invoice.items,
        });
      }
    }
  }

  // ── Bulk writes ──────────────────────────────────────────────────────────────
  // Invoices first (need their ids), then transaction enrichment, then item fills.
  const invoiceRows: InvoiceInsertRow[] = [
    ...matchedEntries.map((m) => buildInvoiceRow(m.invoice, importRunId, 'matched', m.tx.id, m.confidence)),
    ...ambiguousInvoices.map((inv) => buildInvoiceRow(inv, importRunId, 'ambiguous', null, null)),
  ];
  const insertedInvoices = await bulkInsertInvoices(supabase, invoiceRows);
  // Map by invoice_number (unique within toProcess) so id mapping never relies on row order.
  const invoiceIdByNumber = new Map(insertedInvoices.map((r) => [r.invoice_number, r.id]));

  // Decide fill-vs-keep with one batched item read across all matched transactions.
  const existingItems = await getTransactionItemsByTransactionIds(supabase, matchedEntries.map((m) => m.tx.id));
  const existingItemCount = new Map<string, number>();
  for (const it of existingItems) existingItemCount.set(it.transaction_id, (existingItemCount.get(it.transaction_id) ?? 0) + 1);

  const enrichRows: Transaction[] = [];
  const itemRows: { transaction_id: string; name: string; amount: number | null; effective_amount: number | null; tags: string[]; sort_order: number; source_invoice_id: string | null }[] = [];

  for (const m of matchedEntries) {
    const invoiceId = invoiceIdByNumber.get(m.invoice.invoice_number)!;
    enrichRows.push({
      ...m.tx,
      is_matched: true,
      invoice_number: m.invoice.invoice_number,
      seller_name: m.invoice.seller_name || null,
      seller_tax_id: m.invoice.seller_tax_id || null,
      matched_invoice_id: invoiceId,
    });

    let itemsOutcome: ItemsOutcome;
    if ((existingItemCount.get(m.tx.id) ?? 0) > 0) {
      itemsOutcome = 'kept';
    } else {
      itemsOutcome = 'filled';
      const positiveItems = m.invoice.items.filter((li) => li.amount == null || li.amount > 0);
      // Net per-item spend = proportional share of the matched tx's paid amount (handles
      // the invoice discount the parser folded into the allowance). Computed in memory —
      // no per-tx DB round-trip — keying by index since the items have no id pre-insert.
      const shares = computeEffectiveShares(
        positiveItems.map((li, idx) => ({ id: String(idx), amount: li.amount })),
        m.tx.amount
      );
      positiveItems.forEach((li, idx) =>
        itemRows.push({
          transaction_id: m.tx.id,
          name: li.name,
          amount: li.amount,
          effective_amount: shares.get(String(idx)) ?? null,
          tags: [],
          sort_order: idx,
          source_invoice_id: invoiceId,
        })
      );
    }

    if (m.confidence === 'exact') counters.matchedExact++;
    else counters.matchedNear++;
    counters.matched.push({
      seller_name: m.invoice.seller_name || null,
      invoice_number: m.invoice.invoice_number,
      transaction_at: m.tx.transaction_at,
      amount: m.tx.amount,
      confidence: m.confidence,
      items_outcome: itemsOutcome,
    });
  }

  await bulkEnrichTransactions(supabase, enrichRows);
  await bulkInsertTransactionItems(supabase, itemRows);
  counters.ambiguous = ambiguousInvoices.length;

  return counters;
}
