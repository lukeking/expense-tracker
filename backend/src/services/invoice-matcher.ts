import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedInvoice, ImportRun, Invoice, Env } from '../types';
import {
  findExistingInvoiceNumbers,
  findMatchingExpenseTransaction,
  findExactMatchIncludingLinked,
  findForexCandidateTransaction,
  insertInvoice,
  enrichTransaction,
  findAllHeldForexInvoices,
  findAllAmbiguousInvoices,
  resolveHeldInvoice,
  insertTransaction,
} from '../db/queries';
import { parseExpenseText } from './gemini';

export interface AmbiguousItem {
  invoice: ParsedInvoice;
  candidates: import('../types').Transaction[];
}

export interface ReconciliationResult {
  forexLinked: number;
  forexAutoCreated: number;
  forexStillHeld: number;
  ambiguousAutoLinked: number;
  ambiguousAutoCreated: number;
  ambiguousRemaining: Invoice[];
  collisionCount: number;
}

export interface PipelineCounters {
  totalRows: number;
  matchedCount: number;
  autoCreatedCount: number;
  skippedDuplicateCount: number;
  skippedVoidedCount: number;
  skippedZeroCount: number;
  heldForexCount: number;
  ambiguousCount: number;
  ambiguousItems: AmbiguousItem[];
  forexResolvedCount: number;
  parseFailedCount: number;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function runImportPipeline(
  supabase: SupabaseClient,
  invoices: ParsedInvoice[],
  importRunId: string,
  env: Env,
  initialSkipped: { voidedCount: number; zeroCount: number; parseFailedCount: number }
): Promise<PipelineCounters> {
  const counters: PipelineCounters = {
    totalRows: invoices.length + initialSkipped.voidedCount + initialSkipped.zeroCount + initialSkipped.parseFailedCount,
    matchedCount: 0,
    autoCreatedCount: 0,
    skippedDuplicateCount: 0,
    skippedVoidedCount: initialSkipped.voidedCount,
    skippedZeroCount: initialSkipped.zeroCount,
    heldForexCount: 0,
    ambiguousCount: 0,
    ambiguousItems: [],
    forexResolvedCount: 0,
    parseFailedCount: initialSkipped.parseFailedCount,
  };

  // Dedup check
  const invoiceNumbers = invoices.map((i) => i.invoice_number);
  const existingNumbers = new Set(await findExistingInvoiceNumbers(supabase, invoiceNumbers));

  const toProcess: ParsedInvoice[] = [];
  for (const invoice of invoices) {
    if (existingNumbers.has(invoice.invoice_number)) {
      counters.skippedDuplicateCount++;
    } else {
      toProcess.push(invoice);
    }
  }

  // Primary exact-match pass — batched at 100 to stay within CF Workers wall time
  const unmatched: ParsedInvoice[] = [];
  for (const batch of chunk(toProcess, 100)) {
    for (const invoice of batch) {
      const candidates = await findMatchingExpenseTransaction(supabase, invoice.net_amount, invoice.invoice_date);
      if (candidates.length === 1) {
        const tx = candidates[0];
        const inv = await insertInvoice(supabase, invoice, importRunId, 'matched', tx.id);
        await enrichTransaction(supabase, tx.id, {
          invoiceNumber: invoice.invoice_number,
          sellerName: invoice.seller_name || null,
          sellerTaxId: invoice.seller_tax_id || null,
          invoiceId: inv.id,
        });
        counters.matchedCount++;
      } else if (candidates.length > 1) {
        await insertInvoice(supabase, invoice, importRunId, 'ambiguous');
        counters.ambiguousCount++;
        counters.ambiguousItems.push({ invoice, candidates });
      } else {
        unmatched.push(invoice);
      }
    }
  }

  // Secondary forex pass
  const stillUnmatched: ParsedInvoice[] = [];
  for (const invoice of unmatched) {
    const tx = await findForexCandidateTransaction(supabase, invoice.net_amount, invoice.invoice_date);
    if (tx) {
      await insertInvoice(supabase, invoice, importRunId, 'held_forex');
      counters.heldForexCount++;
    } else {
      stillUnmatched.push(invoice);
    }
  }

  // Auto-create for truly unmatched
  for (const invoice of stillUnmatched) {
    const parsed = await parseExpenseText(env, invoice.net_amount, invoice.seller_name || '');
    const tx = await insertTransaction(supabase, {
      amount: invoice.net_amount,
      transaction_type: 'expense',
      payment_method: 'cash',
      items: invoice.items.length > 0
        ? invoice.items.map((i) => ({ name: i.name, amount: i.amount }))
        : parsed.items.map((i) => ({ name: i.name, amount: i.amount ?? 0 })),
      tags: parsed.tags,
      note: invoice.seller_name || null,
      transaction_at: invoice.invoice_date.toISOString(),
    });
    const inv = await insertInvoice(supabase, invoice, importRunId, 'auto_created', tx.id);
    await enrichTransaction(supabase, tx.id, {
      invoiceNumber: invoice.invoice_number,
      sellerName: invoice.seller_name || null,
      sellerTaxId: invoice.seller_tax_id || null,
      invoiceId: inv.id,
    });
    counters.autoCreatedCount++;
  }

  // Post-import reconciliation pass over all held_forex invoices in DB
  const reconcileResult = await runReconciliationPass(supabase, env);
  counters.forexResolvedCount = reconcileResult.forexLinked + reconcileResult.forexAutoCreated;

  return counters;
}

export async function runReconciliationPass(supabase: SupabaseClient, env: Env): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    forexLinked: 0,
    forexAutoCreated: 0,
    forexStillHeld: 0,
    ambiguousAutoLinked: 0,
    ambiguousAutoCreated: 0,
    ambiguousRemaining: [],
    collisionCount: 0,
  };

  // Loop 1: held_forex invoices
  const heldInvoices = await findAllHeldForexInvoices(supabase);
  for (const heldInvoice of heldInvoices) {
    const invoiceDate = new Date(heldInvoice.invoice_date);

    const exactCandidates = await findMatchingExpenseTransaction(supabase, heldInvoice.net_amount, invoiceDate);
    const exactTx = exactCandidates[0] ?? null;
    if (exactTx) {
      await resolveHeldInvoice(supabase, heldInvoice.id, exactTx.id, 'matched');
      await enrichTransaction(supabase, exactTx.id, {
        invoiceNumber: heldInvoice.invoice_number,
        sellerName: heldInvoice.seller_name,
        sellerTaxId: heldInvoice.seller_tax_id,
        invoiceId: heldInvoice.id,
      });
      result.forexLinked++;
      continue;
    }

    // No unlinked exact match — check if an already-linked transaction would have matched (collision)
    const allExactCandidates = await findExactMatchIncludingLinked(supabase, heldInvoice.net_amount, invoiceDate);
    if (allExactCandidates.some((tx) => tx.matched_invoice_id !== null)) {
      result.collisionCount++;
      continue;
    }

    const forexTx = await findForexCandidateTransaction(supabase, heldInvoice.net_amount, invoiceDate);
    if (forexTx) {
      result.forexStillHeld++;
      continue;
    }

    // No candidate at all — auto-create
    const parsed = await parseExpenseText(env, heldInvoice.net_amount, heldInvoice.seller_name ?? '');
    const newTx = await insertTransaction(supabase, {
      amount: heldInvoice.net_amount,
      transaction_type: 'expense',
      payment_method: 'cash',
      items: parsed.items.map((i) => ({ name: i.name, amount: i.amount ?? 0 })),
      tags: parsed.tags,
      note: heldInvoice.seller_name || null,
      transaction_at: invoiceDate.toISOString(),
    });
    await resolveHeldInvoice(supabase, heldInvoice.id, newTx.id, 'auto_created');
    await enrichTransaction(supabase, newTx.id, {
      invoiceNumber: heldInvoice.invoice_number,
      sellerName: heldInvoice.seller_name,
      sellerTaxId: heldInvoice.seller_tax_id,
      invoiceId: heldInvoice.id,
    });
    result.forexAutoCreated++;
  }

  // Loop 2: ambiguous invoices — auto-link if candidate count has dropped to 1
  const ambiguousInvoices = await findAllAmbiguousInvoices(supabase);
  for (const inv of ambiguousInvoices) {
    const invoiceDate = new Date(inv.invoice_date);
    const candidates = await findMatchingExpenseTransaction(supabase, inv.net_amount, invoiceDate);

    if (candidates.length === 1) {
      const tx = candidates[0];
      await resolveHeldInvoice(supabase, inv.id, tx.id, 'matched');
      await enrichTransaction(supabase, tx.id, {
        invoiceNumber: inv.invoice_number,
        sellerName: inv.seller_name,
        sellerTaxId: inv.seller_tax_id,
        invoiceId: inv.id,
      });
      result.ambiguousAutoLinked++;
    } else if (candidates.length === 0) {
      const parsed = await parseExpenseText(env, inv.net_amount, inv.seller_name ?? '');
      const newTx = await insertTransaction(supabase, {
        amount: inv.net_amount,
        transaction_type: 'expense',
        payment_method: 'cash',
        items: parsed.items.map((i) => ({ name: i.name, amount: i.amount ?? 0 })),
        tags: parsed.tags,
        note: inv.seller_name || null,
        transaction_at: invoiceDate.toISOString(),
      });
      await resolveHeldInvoice(supabase, inv.id, newTx.id, 'auto_created');
      await enrichTransaction(supabase, newTx.id, {
        invoiceNumber: inv.invoice_number,
        sellerName: inv.seller_name,
        sellerTaxId: inv.seller_tax_id,
        invoiceId: inv.id,
      });
      result.ambiguousAutoCreated++;
    } else {
      result.ambiguousRemaining.push(inv);
    }
  }

  return result;
}
