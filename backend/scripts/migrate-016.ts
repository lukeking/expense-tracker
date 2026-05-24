#!/usr/bin/env tsx
/**
 * One-time data migration for spec 016: Transaction Adjustments + Legacy Data Cleanup.
 *
 * Supports --dry-run flag: prints planned changes without writing anything.
 * Idempotent: safe to re-run (uses existence checks / ON CONFLICT DO NOTHING).
 *
 * SC-009: Only touches rows with source = 'legacy_migration' for the category-tag migration.
 *
 * Usage (from backend/):
 *   npx tsx scripts/migrate-016.ts --dry-run
 *   npx tsx scripts/migrate-016.ts
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[migrate-016] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

// ─── OLD_TAG → NEW_TAG mapping for orphan_category_tag_on_item (C5) ──────────
// Authored after inspecting the 24 rows with inspect-016-orphans.ts.
// All source tags map into valid (major, subcategory) pairs from the categories table.

const ORPHAN_TAG_MAP: Record<string, string> = {
  '食:小吃':                   '食:點心',
  '食:漢堡王':                  '食:其他',
  '食:點心/早餐':               '食:點心',
  '食:泡麵/早餐':               '食:早餐',
  '食:飯糰/小籠包/麻婆豆腐燴飯': '食:午餐',
  '食:晚餐 牛奶':               '食:晚餐',
  '食:咖啡+瓶裝水':             '食:咖啡',
  '食:燕麥 訂閱':               '食:儲糧',
  '食:冰品 泡麵':               '食:冰品',
};

// ─── items_sum_mismatch fixes (C6) ───────────────────────────────────────────
// Two transactions where SUM(items.amount) ≠ transaction.amount.
// Corrections determined by inspecting rows with inspect-016-orphans.ts.
//
// tx cb772668 (amount=7, "#920 高公局→林口農會2"):
//   item 7e241afe name="#" amount=920 → null  (entry error: "#920" is a receipt ref, not a price)
//   item d6c5811d name="高公局→林口農會" amount=2 → 7  (highway toll, correct price is tx.amount)
//
// tx cec033ff (amount=3, "Switching Hero 去廣告"):
//   item 90eadf23 name="國外交易服務費" amount=1 → 3  (off by 2; amount should equal tx.amount)

interface ItemFix { itemId: string; newAmount: number | null; reason: string }
const ITEM_FIXES: ItemFix[] = [
  { itemId: '7e241afe-8878-4b18-b641-39490cff5a46', newAmount: null, reason: '"#920" is a receipt ref, not a price' },
  { itemId: 'd6c5811d-58fe-4d38-8eff-1a4e1ac6922f', newAmount: 7,    reason: 'highway toll; correct amount = 7 (tx.amount)' },
  { itemId: '90eadf23-fc7c-4d4b-9bdd-db739398a695', newAmount: 3,    reason: 'off by 2; should match tx.amount = 3' },
];

// ─── Paginated fetch ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(makeQuery: () => any): Promise<unknown[]> {
  const PAGE = 1000;
  const all: unknown[] = [];
  let from = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (makeQuery() as any).range(from, from + PAGE - 1);
    if (error) throw new Error((error as { message: string }).message);
    if (!data || (data as unknown[]).length === 0) break;
    all.push(...(data as unknown[]));
    if ((data as unknown[]).length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// ─── C1: Backfill transactions_without_items ──────────────────────────────────

async function c1BackfillTransactionsWithoutItems(supabase: SupabaseClient): Promise<void> {
  console.log('[C1] Backfilling transactions without items…');

  type TxRow = { id: string; amount: number; note: string | null; tags: string[]; transaction_at: string; source: string | null };
  const [allTxs, allItemRefs] = await Promise.all([
    fetchAll(() => supabase.from('transactions').select('id, amount, note, tags, transaction_at, source')) as Promise<TxRow[]>,
    fetchAll(() => supabase.from('transaction_items').select('transaction_id')) as Promise<{ transaction_id: string }[]>,
  ]);

  const txIdsWithItems = new Set(allItemRefs.map(r => r.transaction_id));
  const withoutItems = allTxs.filter(t => !txIdsWithItems.has(t.id));

  console.log(`[C1]   ${withoutItems.length} transactions without items`);

  for (const tx of withoutItems) {
    const catTag = (tx.tags ?? []).find(t => /^[^:]+:[^:]+$/.test(t)) ?? null;
    const row = {
      transaction_id: tx.id,
      name: tx.note ?? '（未分類）',
      amount: tx.amount,
      tags: catTag ? [catTag] : [],
      sort_order: 0,
      effective_amount: tx.amount,
    };
    console.log(`[C1]   tx=${tx.id} → insert item name="${row.name}" amount=${row.amount}`);
    if (!DRY_RUN) {
      const { error } = await supabase.from('transaction_items').insert(row);
      if (error) throw new Error(`C1 insertItem: ${error.message}`);
    }
  }
  console.log('[C1] done');
}

// ─── C2: Migrate category tags from transactions.tags → transaction_items.tags ─

async function c2MigrateCategoryTags(supabase: SupabaseClient): Promise<void> {
  console.log('[C2] Migrating category tags from transactions to items (source=legacy_migration)…');

  const CAT_TAG_RE = /^[^:]+:[^:]+$/;

  type TxRow = { id: string; tags: string[] };
  type ItemRow = { id: string; transaction_id: string; tags: string[]; sort_order: number };

  const [txsRaw, itemsRaw] = await Promise.all([
    fetchAll(() =>
      supabase.from('transactions').select('id, tags').eq('source', 'legacy_migration')
    ) as Promise<TxRow[]>,
    fetchAll(() =>
      supabase.from('transaction_items').select('id, transaction_id, tags, sort_order')
    ) as Promise<ItemRow[]>,
  ]);

  const txsWithCatTag = txsRaw.filter(t => (t.tags ?? []).some(tag => CAT_TAG_RE.test(tag)));
  console.log(`[C2]   ${txsWithCatTag.length} transactions with category tags on transactions`);

  const itemsByTx = new Map<string, ItemRow[]>();
  for (const item of itemsRaw) {
    const existing = itemsByTx.get(item.transaction_id) ?? [];
    existing.push(item);
    itemsByTx.set(item.transaction_id, existing);
  }

  let migrated = 0;
  for (const tx of txsWithCatTag) {
    const catTags = (tx.tags ?? []).filter(tag => CAT_TAG_RE.test(tag));
    const plainTags = (tx.tags ?? []).filter(tag => !CAT_TAG_RE.test(tag));

    const items = (itemsByTx.get(tx.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    const targetItem = items[0];

    if (!targetItem) {
      console.log(`[C2]   WARN: tx=${tx.id} has no items; skipping (C1 should have created one)`);
      continue;
    }

    for (const catTag of catTags) {
      const newItemTags = [...new Set([...targetItem.tags, catTag])];
      console.log(`[C2]   tx=${tx.id} item=${targetItem.id}: add tag "${catTag}"`);

      if (!DRY_RUN) {
        const { error } = await supabase
          .from('transaction_items')
          .update({ tags: newItemTags })
          .eq('id', targetItem.id);
        if (error) throw new Error(`C2 updateItemTags: ${error.message}`);

        const { error: txErr } = await supabase
          .from('transactions')
          .update({ tags: plainTags })
          .eq('id', tx.id);
        if (txErr) throw new Error(`C2 updateTxTags: ${txErr.message}`);
      }

      migrated++;
    }
  }
  console.log(`[C2]   migrated ${migrated} category tags`);
  console.log('[C2] done');
}

// ─── C3: Convert fee/refund transactions with parent → adjustments ────────────

async function c3ConvertFeeRefundTransactions(supabase: SupabaseClient): Promise<void> {
  console.log('[C3] Converting fee/refund transactions with parent_transaction_id to adjustments…');

  type TxRow = {
    id: string; amount: number; note: string | null; transaction_type: string;
    parent_transaction_id: string; transaction_at: string; source: string | null;
  };

  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, note, transaction_type, parent_transaction_id, transaction_at, source')
    .in('transaction_type', ['fee', 'refund'])
    .not('parent_transaction_id', 'is', null);
  if (error) throw new Error(`C3 fetch: ${error.message}`);

  const toConvert = (data ?? []) as TxRow[];
  console.log(`[C3]   ${toConvert.length} fee/refund transactions with parent to convert`);

  for (const tx of toConvert) {
    const kind = tx.transaction_type === 'fee' ? 'fee' : 'refund';
    const adjRow = {
      transaction_id: tx.parent_transaction_id,
      kind,
      amount: Math.abs(tx.amount),
      note: tx.note,
      transaction_at: tx.transaction_at,
      source: 'legacy_migration',
    };
    console.log(`[C3]   tx=${tx.id} (${tx.transaction_type}, amount=${tx.amount}) → adjustment on parent=${tx.parent_transaction_id}`);

    if (!DRY_RUN) {
      // Insert adjustment (idempotent: if already converted, skip)
      const { error: adjErr } = await supabase
        .from('transaction_adjustments')
        .insert(adjRow);
      if (adjErr && !adjErr.message.includes('duplicate')) {
        throw new Error(`C3 insertAdjustment: ${adjErr.message}`);
      }

      // Delete original fee/refund transaction
      const { error: delErr } = await supabase
        .from('transactions')
        .delete()
        .eq('id', tx.id);
      if (delErr) throw new Error(`C3 deleteTransaction: ${delErr.message}`);
    }
  }
  console.log('[C3] done');
}

// ─── C4: Print orphan fee/refund rows (no parent) ────────────────────────────

async function c4PrintOrphanFeeRefund(supabase: SupabaseClient): Promise<void> {
  console.log('[C4] Identifying orphan fee/refund rows (no parent_transaction_id)…');

  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, note, transaction_type, transaction_at, source')
    .in('transaction_type', ['fee', 'refund'])
    .is('parent_transaction_id', null);
  if (error) throw new Error(`C4 fetch: ${error.message}`);

  const orphans = data ?? [];
  console.log(`[C4]   ${orphans.length} orphan fee/refund rows (left untouched — manual resolution required):`);
  for (const tx of orphans) {
    console.log(`[C4]   id=${(tx as { id: string }).id} type=${(tx as { transaction_type: string }).transaction_type} amount=${(tx as { amount: number }).amount} note="${(tx as { note: string | null }).note}" at=${(tx as { transaction_at: string }).transaction_at}`);
  }
  console.log('[C4] done (see spec Post-Migration Manual Steps for resolution)');
}

// ─── C5: Fix orphan_category_tag_on_item via mapping table ───────────────────

async function c5FixOrphanCategoryTags(supabase: SupabaseClient): Promise<void> {
  console.log('[C5] Fixing orphan category tags on items…');

  type ItemRow = { id: string; tags: string[] };
  const itemsRaw = await fetchAll(() =>
    supabase.from('transaction_items').select('id, tags')
  ) as ItemRow[];

  const CAT_TAG_RE = /^[^:]+:[^:]+$/;
  const toFix = itemsRaw.filter(i =>
    (i.tags ?? []).some(t => CAT_TAG_RE.test(t) && ORPHAN_TAG_MAP[t])
  );

  console.log(`[C5]   ${toFix.length} items to fix`);
  let fixed = 0;
  for (const item of toFix) {
    const newTags = (item.tags ?? []).map(t => ORPHAN_TAG_MAP[t] ?? t);
    console.log(`[C5]   item=${item.id} tags: ${JSON.stringify(item.tags)} → ${JSON.stringify(newTags)}`);

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('transaction_items')
        .update({ tags: newTags })
        .eq('id', item.id);
      if (error) throw new Error(`C5 updateItem: ${error.message}`);
    }
    fixed++;
  }
  console.log(`[C5]   fixed ${fixed} items`);
  console.log('[C5] done');
}

// ─── C6: Fix items_sum_mismatch rows ─────────────────────────────────────────

async function c6FixItemsSumMismatch(supabase: SupabaseClient): Promise<void> {
  console.log('[C6] Applying items_sum_mismatch fixes…');

  for (const fix of ITEM_FIXES) {
    console.log(`[C6]   item=${fix.itemId} → amount=${fix.newAmount} (${fix.reason})`);

    if (!DRY_RUN) {
      const { error } = await supabase
        .from('transaction_items')
        .update({ amount: fix.newAmount, effective_amount: fix.newAmount })
        .eq('id', fix.itemId);
      if (error) throw new Error(`C6 updateItem: ${error.message}`);
    }
  }
  console.log('[C6] done');
}

// ─── C7: Final recompute of effective_amount for transactions with adjustments ─

async function c7RecomputeEffectiveAmounts(supabase: SupabaseClient): Promise<void> {
  console.log('[C7] Recomputing effective_amount for all transactions with adjustments…');

  if (DRY_RUN) {
    console.log('[C7]   (dry run — skipping recompute)');
    console.log('[C7] done');
    return;
  }

  // Get all transactions that have at least one adjustment row
  const { data, error } = await supabase
    .from('transaction_adjustments')
    .select('transaction_id');
  if (error) throw new Error(`C7 fetch adjustments: ${error.message}`);

  const txIds = [...new Set((data ?? []).map((r: { transaction_id: string }) => r.transaction_id))];
  console.log(`[C7]   ${txIds.length} transactions to recompute`);

  for (const txId of txIds) {
    // Fetch transaction amount
    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .select('amount')
      .eq('id', txId)
      .single();
    if (txErr || !tx) {
      console.log(`[C7]   WARN: tx=${txId} not found; skipping`);
      continue;
    }

    // Fetch items
    const { data: items, error: itemsErr } = await supabase
      .from('transaction_items')
      .select('id, amount, sort_order')
      .eq('transaction_id', txId)
      .order('sort_order', { ascending: true });
    if (itemsErr) throw new Error(`C7 fetch items: ${itemsErr.message}`);

    const eligible = (items ?? []).filter((i: { amount: number | null }) => i.amount != null) as { id: string; amount: number; sort_order: number }[];
    if (eligible.length === 0) continue;

    const paidTotal = (tx as { amount: number }).amount;
    const itemsTotal = eligible.reduce((s, i) => s + i.amount, 0);
    if (itemsTotal === 0) continue;

    const shares = eligible.map(i => ({ id: i.id, amount: i.amount, ea: Math.floor(i.amount * paidTotal / itemsTotal) }));
    const remainder = paidTotal - shares.reduce((s, x) => s + x.ea, 0);
    const maxAmount = Math.max(...shares.map(s => s.amount));
    const largestIdx = shares.reduce((bestIdx, s, idx) => (s.amount >= maxAmount ? idx : bestIdx), 0);
    shares[largestIdx].ea += remainder;

    for (const s of shares) {
      const { error: updateErr } = await supabase
        .from('transaction_items')
        .update({ effective_amount: s.ea })
        .eq('id', s.id);
      if (updateErr) throw new Error(`C7 update: ${updateErr.message}`);
    }

    console.log(`[C7]   tx=${txId} recomputed ${shares.length} items`);
  }
  console.log('[C7] done');
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[migrate-016] Starting${DRY_RUN ? ' (DRY RUN — no writes)' : ''}…`);
  console.log('[migrate-016] Mapping table:');
  for (const [old, newTag] of Object.entries(ORPHAN_TAG_MAP)) {
    console.log(`  "${old}" → "${newTag}"`);
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } });

  await c1BackfillTransactionsWithoutItems(supabase);
  await c2MigrateCategoryTags(supabase);
  await c3ConvertFeeRefundTransactions(supabase);
  await c4PrintOrphanFeeRefund(supabase);
  await c5FixOrphanCategoryTags(supabase);
  await c6FixItemsSumMismatch(supabase);
  await c7RecomputeEffectiveAmounts(supabase);

  console.log(`\n[migrate-016] Complete${DRY_RUN ? ' (DRY RUN — no data was modified)' : ''}.`);
  if (!DRY_RUN) {
    console.log('[migrate-016] Run tsx scripts/audit-legacy.ts to verify SC-001 through SC-006.');
  }
}

main().catch(err => {
  console.error('[migrate-016] Fatal error:', err);
  process.exit(1);
});
