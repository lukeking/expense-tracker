import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedInvoice, ImportRun, Env } from '../types';
import {
  findExistingInvoiceNumbers,
  findMatchingExpenseTransaction,
  findForexCandidateTransaction,
  insertInvoice,
  enrichTransaction,
  findAllHeldForexInvoices,
  resolveHeldInvoice,
  insertTransaction,
} from '../db/queries';
import { parseExpenseText } from './gemini';

export interface PipelineCounters {
  totalRows: number;
  matchedCount: number;
  autoCreatedCount: number;
  skippedDuplicateCount: number;
  skippedVoidedCount: number;
  skippedZeroCount: number;
  heldForexCount: number;
  forexResolvedCount: number;
  parseFailedCount: number;
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

  // Primary exact-match pass
  const unmatched: ParsedInvoice[] = [];
  for (const invoice of toProcess) {
    const tx = await findMatchingExpenseTransaction(supabase, invoice.net_amount, invoice.invoice_date);
    if (tx) {
      const inv = await insertInvoice(supabase, invoice, importRunId, 'matched', tx.id);
      await enrichTransaction(supabase, tx.id, {
        invoiceNumber: invoice.invoice_number,
        sellerName: invoice.seller_name || null,
        sellerTaxId: invoice.seller_tax_id || null,
        invoiceId: inv.id,
      });
      counters.matchedCount++;
    } else {
      unmatched.push(invoice);
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
  const forexResolved = await runReconciliationPass(supabase, env);
  counters.forexResolvedCount = forexResolved;

  return counters;
}

export async function runReconciliationPass(supabase: SupabaseClient, env: Env): Promise<number> {
  const heldInvoices = await findAllHeldForexInvoices(supabase);
  let resolved = 0;

  for (const heldInvoice of heldInvoices) {
    const invoiceDate = new Date(heldInvoice.invoice_date);

    // Try exact match first
    const exactTx = await findMatchingExpenseTransaction(supabase, heldInvoice.net_amount, invoiceDate);
    if (exactTx) {
      await resolveHeldInvoice(supabase, heldInvoice.id, exactTx.id, 'matched');
      await enrichTransaction(supabase, exactTx.id, {
        invoiceNumber: heldInvoice.invoice_number,
        sellerName: heldInvoice.seller_name,
        sellerTaxId: heldInvoice.seller_tax_id,
        invoiceId: heldInvoice.id,
      });
      resolved++;
      continue;
    }

    // Try forex candidate still within ±5%
    const forexTx = await findForexCandidateTransaction(supabase, heldInvoice.net_amount, invoiceDate);
    if (forexTx) {
      // Still a forex candidate — leave as held_forex
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
    resolved++;
  }

  return resolved;
}
