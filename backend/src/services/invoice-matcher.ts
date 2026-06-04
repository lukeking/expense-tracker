import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedInvoice, InvoiceItem, MatchConfidence, ItemsOutcome, MatchedInvoiceDetail } from '../types';
import {
  findExistingInvoiceNumbers,
  findMatchingExpenseTransaction,
  findForexCandidateTransactions,
  insertInvoice,
  enrichTransaction,
  getTransactionItems,
  insertTransactionItems,
  replaceTransactionItems,
} from '../db/queries';

// Invoice Import v2 — enrichment only. The pipeline NEVER creates transactions
// (FR-005). It auto-links an invoice only when exactly one exact-amount candidate
// exists within ±2 days; ≥2 exact candidates, or (when no exact candidate exists)
// any ±5%/±7-day forex candidate, are held `ambiguous` for manual resolution.

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
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
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

// Items rule (FR-008/009): on replace, swap existing items for the invoice's
// positive-amount line items (`replaced`); otherwise fill only when the transaction
// has no items (`filled`), else leave them untouched (`kept`).
export async function applyInvoiceItems(
  supabase: SupabaseClient,
  transactionId: string,
  invoiceLineItems: InvoiceItem[],
  replace: boolean
): Promise<ItemsOutcome> {
  const positiveItems = invoiceLineItems.filter((li) => li.amount == null || li.amount > 0);
  const mapItems = () =>
    positiveItems.map((li, idx) => ({ name: li.name, amount: li.amount, tags: [] as string[], sort_order: idx }));

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

  // Batched at 100 to stay within CF Workers wall time.
  for (const batch of chunk(toProcess, 100)) {
    for (const invoice of batch) {
      const exact = await findMatchingExpenseTransaction(supabase, invoice.net_amount, invoice.invoice_date);

      if (exact.length === 1) {
        const tx = exact[0];
        const confidence = computeConfidence(invoice.invoice_date.toISOString(), tx.transaction_at, tx.amount, invoice.net_amount);
        const inv = await insertInvoice(supabase, invoice, importRunId, 'matched', tx.id, confidence);
        await enrichTransaction(supabase, tx.id, {
          invoiceNumber: invoice.invoice_number,
          sellerName: invoice.seller_name || null,
          sellerTaxId: invoice.seller_tax_id || null,
          invoiceId: inv.id,
        });
        const itemsOutcome = await applyInvoiceItems(supabase, tx.id, invoice.items, false);
        if (confidence === 'exact') counters.matchedExact++;
        else counters.matchedNear++;
        counters.matched.push({
          seller_name: invoice.seller_name || null,
          invoice_number: invoice.invoice_number,
          transaction_at: tx.transaction_at,
          amount: tx.amount,
          confidence,
          items_outcome: itemsOutcome,
        });
      } else if (exact.length >= 2) {
        await insertInvoice(supabase, invoice, importRunId, 'ambiguous');
        counters.ambiguous++;
      } else {
        // No exact candidate — fall back to ±5%/±7-day forex candidates (never auto-linked).
        const forex = await findForexCandidateTransactions(supabase, invoice.net_amount, invoice.invoice_date);
        if (forex.length >= 1) {
          await insertInvoice(supabase, invoice, importRunId, 'ambiguous');
          counters.ambiguous++;
        } else {
          // Zero candidates — counted only; no invoice row persisted (FR-007), so a
          // later import can retry once a matching transaction exists.
          counters.skippedUnmatched++;
        }
      }
    }
  }

  return counters;
}
