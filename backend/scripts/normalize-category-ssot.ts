#!/usr/bin/env tsx
/**
 * Feature 027 (B2): one-off normalization of category storage to the single-source
 * model — strips item-level copies of the tx category (they become live inheritance)
 * and promotes the unanimous category of category-less transactions to tx level.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/normalize-category-ssot.ts            # dry-run (default): report only
 *   npx tsx scripts/normalize-category-ssot.ts --apply    # persist the changes
 *
 * Safety (research.md D3):
 *  - Total-preserving guard: a tx whose aggregateByCategory buckets would change is
 *    SKIPPED and reported (the old shape stays read-correct via the remainder dedupe).
 *  - No transaction_edit_history rows are written — this is a representation change,
 *    not a user edit.
 *  - Idempotent: a second run reports zero pending changes.
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { planTransactionNormalization } from '../src/services/item-category';
import { aggregateByCategory } from '../src/services/summary';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[normalize-category-ssot] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const PAGE_SIZE = 500;

interface TxRow {
  id: string;
  amount: number;
  transaction_type: string;
  transaction_at: string;
  tags: string[];
  transaction_items: { id: string; amount: number | null; effective_amount: number | null; tags: string[] }[];
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function shape(tx: TxRow, plan?: { txTags: string[]; itemTags: string[][] }) {
  return {
    amount: tx.amount,
    transaction_type: tx.transaction_type,
    tags: plan ? plan.txTags : tx.tags,
    transaction_items: tx.transaction_items.map((it, i) => ({
      amount: it.amount,
      effective_amount: it.effective_amount,
      tags: plan ? plan.itemTags[i] : it.tags,
    })),
  };
}

function bucketKey(tx: TxRow, plan?: { txTags: string[]; itemTags: string[][] }): string {
  return JSON.stringify(aggregateByCategory([shape(tx, plan)]));
}

function periodOf(iso: string): string {
  return iso.slice(0, 7); // YYYY-MM
}

function addTotals(map: Map<string, Map<string, number>>, period: string, tx: TxRow, plan?: { txTags: string[]; itemTags: string[][] }) {
  const buckets = aggregateByCategory([shape(tx, plan)]);
  const inner = map.get(period) ?? new Map<string, number>();
  for (const b of buckets) inner.set(b.category, (inner.get(b.category) ?? 0) + b.total);
  map.set(period, inner);
}

async function fetchAll(): Promise<TxRow[]> {
  const all: TxRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, amount, transaction_type, transaction_at, tags, transaction_items(id, amount, effective_amount, tags)')
      .order('transaction_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as TxRow[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

async function main() {
  console.log(`[normalize-category-ssot] mode: ${APPLY ? 'APPLY' : 'dry-run'}`);
  const txs = await fetchAll();
  console.log(`[normalize-category-ssot] loaded ${txs.length} transactions`);

  const beforeTotals = new Map<string, Map<string, number>>();
  const afterTotals = new Map<string, Map<string, number>>();
  let promoted = 0;
  let collapsedItems = 0;
  let unchanged = 0;
  const skipped: { id: string; at: string; reason: string }[] = [];
  const writes: { txId: string; txTags: string[] | null; items: { id: string; tags: string[] }[] }[] = [];

  for (const tx of txs) {
    const period = periodOf(tx.transaction_at);
    addTotals(beforeTotals, period, tx);

    const plan = planTransactionNormalization({ tags: tx.tags, items: tx.transaction_items.map((i) => ({ tags: i.tags })) });
    if (plan === null) {
      unchanged += 1;
      addTotals(afterTotals, period, tx);
      continue;
    }

    // Total-preserving guard: any bucket difference → skip, keep the old shape.
    if (bucketKey(tx) !== bucketKey(tx, plan)) {
      skipped.push({ id: tx.id, at: tx.transaction_at, reason: 'bucket mismatch (item amounts vs tx amount)' });
      addTotals(afterTotals, period, tx);
      continue;
    }

    const txTagsChanged = JSON.stringify(plan.txTags) !== JSON.stringify(tx.tags);
    if (txTagsChanged) promoted += 1;
    const changedItems = tx.transaction_items.filter((it, i) => JSON.stringify(plan.itemTags[i]) !== JSON.stringify(it.tags));
    collapsedItems += changedItems.length;

    writes.push({
      txId: tx.id,
      txTags: txTagsChanged ? plan.txTags : null,
      items: tx.transaction_items
        .map((it, i) => ({ id: it.id, tags: plan.itemTags[i], changed: JSON.stringify(plan.itemTags[i]) !== JSON.stringify(it.tags) }))
        .filter((x) => x.changed)
        .map(({ id, tags }) => ({ id, tags })),
    });
    addTotals(afterTotals, period, tx, plan);
  }

  // ── Verification (FR-010 / SC-002): per-period per-category totals must match ──
  let driftCount = 0;
  const periods = [...new Set([...beforeTotals.keys(), ...afterTotals.keys()])].sort();
  for (const p of periods) {
    const b = beforeTotals.get(p) ?? new Map();
    const a = afterTotals.get(p) ?? new Map();
    const cats = new Set([...b.keys(), ...a.keys()]);
    for (const c of cats) {
      if ((b.get(c) ?? 0) !== (a.get(c) ?? 0)) {
        driftCount += 1;
        console.error(`  DRIFT ${p} ${c}: before=${b.get(c) ?? 0} after=${a.get(c) ?? 0}`);
      }
    }
  }

  console.log('');
  console.log('── Report ─────────────────────────────────────');
  console.log(`transactions:        ${txs.length}`);
  console.log(`already normalized:  ${unchanged}`);
  console.log(`to update:           ${writes.length}`);
  console.log(`  promotions (tx gains category): ${promoted}`);
  console.log(`  item tags collapsed to inherit: ${collapsedItems}`);
  console.log(`guard-skipped:       ${skipped.length}`);
  for (const s of skipped) console.log(`  SKIP ${s.id} (${s.at}) — ${s.reason}`);
  console.log(`periods verified:    ${periods.length}`);
  console.log(`total drift:         ${driftCount === 0 ? 'NONE — per-period totals identical ✓' : `${driftCount} bucket(s) DIFFER ✗`}`);

  if (driftCount > 0) {
    console.error('[normalize-category-ssot] verification failed — aborting (nothing written)');
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\n[normalize-category-ssot] dry-run complete — re-run with --apply to persist');
    return;
  }

  console.log('\n[normalize-category-ssot] applying…');
  let applied = 0;
  for (const w of writes) {
    if (w.txTags !== null) {
      const { error } = await supabase.from('transactions').update({ tags: w.txTags }).eq('id', w.txId);
      if (error) throw new Error(`tx ${w.txId} update failed: ${error.message}`);
    }
    for (const item of w.items) {
      const { error } = await supabase.from('transaction_items').update({ tags: item.tags }).eq('id', item.id);
      if (error) throw new Error(`item ${item.id} update failed: ${error.message}`);
    }
    applied += 1;
    if (applied % 100 === 0) console.log(`  …${applied}/${writes.length}`);
  }
  console.log(`[normalize-category-ssot] done — ${applied} transactions updated`);
}

main().catch((e) => {
  console.error('[normalize-category-ssot] fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
