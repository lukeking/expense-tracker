#!/usr/bin/env tsx
/**
 * One-time backfill (feature 025): recompute transaction_items.effective_amount for
 * transactions filled from DISCOUNTED invoices, so category summaries reflect net spend.
 *
 * A transaction is "discounted invoice-filled" when it has at least one item with a
 * source_invoice_id AND its items' face total != the transaction's paid amount. For those,
 * effective_amount is recomputed as each item's proportional share of the paid amount
 * (the same rule used everywhere else). Idempotent; non-discounted and manual rows are
 * left untouched.
 *
 * Usage:
 *   cd backend
 *   pnpm tsx scripts/backfill-effective-amounts.ts            # dry-run (default): prints before→after
 *   pnpm tsx scripts/backfill-effective-amounts.ts --apply    # writes the corrections
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { computeEffectiveShares } from '../src/db/queries';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[backfill-effective] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const apply = process.argv.slice(2).includes('--apply');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient<any>(SUPABASE_URL, SUPABASE_KEY);

interface ItemRow {
  id: string;
  transaction_id: string;
  amount: number | null;
  sort_order: number;
  effective_amount: number | null;
  source_invoice_id: string | null;
}

async function main(): Promise<void> {
  // 1. Transactions that have at least one invoice-sourced item.
  const { data: provItems, error: provErr } = await supabase
    .from('transaction_items')
    .select('transaction_id')
    .not('source_invoice_id', 'is', null);
  if (provErr) throw new Error(provErr.message);
  const txIds = [...new Set((provItems ?? []).map((r: { transaction_id: string }) => r.transaction_id))];
  if (txIds.length === 0) {
    console.log('[backfill-effective] no invoice-filled transactions found.');
    return;
  }

  // 2. Their paid amounts.
  const { data: txs, error: txErr } = await supabase.from('transactions').select('id, amount').in('id', txIds);
  if (txErr) throw new Error(txErr.message);
  const paidById = new Map<string, number>((txs ?? []).map((t: { id: string; amount: number }) => [t.id, t.amount]));

  // 3. ALL items for those transactions (effective_amount is computed over the full item set).
  const { data: items, error: itErr } = await supabase
    .from('transaction_items')
    .select('id, transaction_id, amount, sort_order, effective_amount, source_invoice_id')
    .in('transaction_id', txIds)
    .order('sort_order', { ascending: true });
  if (itErr) throw new Error(itErr.message);
  const byTx = new Map<string, ItemRow[]>();
  for (const it of (items ?? []) as ItemRow[]) {
    const arr = byTx.get(it.transaction_id) ?? [];
    arr.push(it);
    byTx.set(it.transaction_id, arr);
  }

  let scanned = 0;
  let discounted = 0;
  let changed = 0;
  let updatedItems = 0;

  for (const [txId, txItems] of byTx) {
    const paid = paidById.get(txId);
    if (paid == null) continue;
    scanned++;

    const faceTotal = txItems.reduce((s, i) => s + (i.amount ?? 0), 0);
    if (faceTotal === paid) continue; // not discounted — leave untouched
    discounted++;

    const shares = computeEffectiveShares(txItems, paid);
    const diffs: { id: string; from: number | null; to: number }[] = [];
    for (const it of txItems) {
      const desired = shares.get(it.id);
      if (desired == null) continue; // null-amount item — not apportioned
      if (it.effective_amount !== desired) diffs.push({ id: it.id, from: it.effective_amount, to: desired });
    }
    if (diffs.length === 0) continue; // already correct (idempotent re-run)
    changed++;

    console.log(`tx ${txId}  paid=${paid}  face=${faceTotal}  → ${diffs.length} item(s):`);
    for (const d of diffs) console.log(`    item ${d.id}: ${d.from ?? 'null'} → ${d.to}`);

    if (apply) {
      for (const d of diffs) {
        const { error: upErr } = await supabase.from('transaction_items').update({ effective_amount: d.to }).eq('id', d.id);
        if (upErr) throw new Error(`update ${d.id}: ${upErr.message}`);
        updatedItems++;
      }
    }
  }

  console.log(
    `\n[backfill-effective] ${apply ? 'APPLIED' : 'DRY-RUN'}: scanned ${scanned} invoice-filled tx, ` +
      `${discounted} discounted, ${changed} needed correction${apply ? `, ${updatedItems} items updated` : ' (no writes)'}.`
  );
  if (!apply && changed > 0) console.log('Re-run with --apply to write these changes.');
}

main().catch((e) => {
  console.error('[backfill-effective]', e);
  process.exit(1);
});
