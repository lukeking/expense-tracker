#!/usr/bin/env tsx
/**
 * Audit: expenses whose line items + adjustments don't reconcile to the paid amount.
 *
 * The entry form enforces `SUM(items) − discount − refund + fee = paid`. When that
 * identity is broken on a stored expense, an adjustment is usually missing (most often a
 * lost `discount`) or was entered slightly off. This surfaces those rows so they can be
 * fixed in the PWA editor.
 *
 *   gap = (SUM(item.amount) − discount − refund + fee) − paid
 *     gap > 0  → recorded items cost more than was paid, with nothing to explain it
 *               ⇒ likely a MISSING DISCOUNT of ~gap
 *     gap < 0  → paid more than the items sum ⇒ likely a missing fee (or an over-entered discount)
 *
 * Blind spot: this can only flag expenses recorded with per-item amounts. A legacy expense
 * imported as a single item = the *net* paid amount carries no sticker/paid gap, so a discount
 * lost together with its line-item detail is undetectable here (there is simply no signal).
 *
 * Totals are unaffected either way — `classify()` always allocates the full `paid` amount
 * (the remainder follows the tx category); the gap is only an item-level discrepancy.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/audit-reconciliation.ts
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in backend/.env (loaded via dotenv).
 * Read-only — SELECTs only.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}
const s = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Row {
  id: string;
  amount: number;
  transaction_at: string;
  source: string | null;
  note: string | null;
  transaction_items: { amount: number | null }[];
  transaction_adjustments: { kind: string; amount: number }[];
}

async function fetchAllExpenses(): Promise<Row[]> {
  const out: Row[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await s
      .from('transactions')
      .select('id, amount, transaction_at, source, note, transaction_items(amount), transaction_adjustments(kind, amount)')
      .eq('transaction_type', 'expense')
      .range(from, from + page - 1);
    if (error) throw new Error(`fetch: ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if ((data ?? []).length < page) break;
  }
  return out;
}

async function main() {
  const rows = await fetchAllExpenses();
  console.log(`Scanned ${rows.length} expense transactions.\n`);

  const mismatches: { date: string; paid: number; sticker: number; disc: number; fee: number; ref: number; gap: number; src: string; note: string; id: string }[] = [];

  for (const t of rows) {
    const items = t.transaction_items ?? [];
    // Only reconcilable when every item carries an amount (remainder-only rows can't be checked).
    if (items.length === 0 || items.some((i) => i.amount == null)) continue;

    const sticker = items.reduce((x, i) => x + (i.amount as number), 0);
    let disc = 0, fee = 0, ref = 0;
    for (const a of t.transaction_adjustments ?? []) {
      if (a.kind === 'discount') disc += a.amount;
      else if (a.kind === 'fee') fee += a.amount;
      else if (a.kind === 'refund') ref += a.amount;
    }
    const gap = sticker - disc - ref + fee - t.amount;
    if (gap !== 0) {
      mismatches.push({
        date: t.transaction_at.slice(0, 10), paid: t.amount, sticker, disc, fee, ref, gap,
        src: t.source ?? '?', note: t.note ?? '', id: t.id.slice(0, 8),
      });
    }
  }

  console.log(`Non-reconciling expenses: ${mismatches.length}`);
  const bySrc: Record<string, number> = {};
  for (const m of mismatches) bySrc[m.src] = (bySrc[m.src] ?? 0) + 1;
  console.log(`By source: ${JSON.stringify(bySrc)}\n`);

  for (const m of mismatches.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))) {
    const hint = m.gap > 0 ? `~missing discount ${m.gap}` : `paid>items ${-m.gap}`;
    console.log(`${m.date}  id=${m.id}  paid=${m.paid}  sticker=${m.sticker}  disc=${m.disc} fee=${m.fee} ref=${m.ref}  GAP=${m.gap} (${hint})  src=${m.src}  note="${m.note}"`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
