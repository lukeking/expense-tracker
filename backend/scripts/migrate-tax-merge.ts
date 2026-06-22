#!/usr/bin/env tsx
/**
 * Merge 其他:所得稅 + 其他:關稅 → 其他:稅金 (a deliberate, formal tax bucket).
 *
 * Rationale: 所得稅 was a migration artifact (sort_order 9999) and 關稅 had no category at
 * all; both are low-volume, so a single 稅金 sub loses no summary granularity while
 * formalizing the bucket. The specific tax kind survives as a plain tag.
 *
 *   catalog : add 其他:稅金 (formal sort_order); remove 其他:所得稅 from the picker.
 *   records : 其他:所得稅  → 其他:稅金 + plain tag 所得稅
 *             untagged 關稅 payment → 其他:稅金 + plain tag 關稅
 *
 * Idempotent. Read-only by default; set APPLY=1 to write.
 *   cd backend
 *   npx tsx scripts/migrate-tax-merge.ts          # dry run
 *   APPLY=1 npx tsx scripts/migrate-tax-merge.ts  # execute
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.env.APPLY === '1';
const OLD = '其他:所得稅';
const NEW = '其他:稅金';

type Tx = { id: string; amount: number; transaction_at: string; tags: string[]; note: string | null };

/** Replace the OLD category tag with NEW and append `plain` if absent; preserve everything else. */
function retag(tags: string[], plain: string): string[] {
  const out = tags.map((t) => (t === OLD ? NEW : t));
  if (!out.includes(NEW)) out.push(NEW); // for the untagged 關稅 row
  if (!out.includes(plain)) out.push(plain);
  return out;
}

async function main() {
  console.log(`\n=== migrate-tax-merge (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  // --- catalog: existing 其他 tax-ish rows + pick a sort_order for 稅金 ---
  const { data: cats } = await s.from('categories').select('major, subcategory, sort_order').eq('major', '其他');
  const others = cats ?? [];
  const has稅金 = others.find((c) => c.subcategory === '稅金');
  const formalMax = Math.max(0, ...others.filter((c) => (c.sort_order ?? 9999) < 9999).map((c) => c.sort_order as number));
  const 稅金Order = has稅金 ? (has稅金.sort_order as number) : formalMax + 10;
  console.log('catalog 其他 tax rows now:',
    others.filter((c) => ['所得稅', '關稅', '稅金'].includes(c.subcategory as string))
      .map((c) => `${c.subcategory}(sort=${c.sort_order})`).join(', ') || '(none of 所得稅/關稅/稅金)');
  console.log(`→ will ${has稅金 ? 'keep' : 'create'} 其他:稅金 sort_order=${稅金Order}; will remove 其他:所得稅 from catalog\n`);

  // --- records: 所得稅 (tx-level + item-level) ---
  const { data: incomeTxRaw } = await s.from('transactions')
    .select('id, amount, transaction_at, tags, note').contains('tags', [OLD]);
  const incomeTx = (incomeTxRaw ?? []) as Tx[];
  const { data: incomeItems } = await s.from('transaction_items')
    .select('id, transaction_id, tags').contains('tags', [OLD]);

  // --- records: untagged 關稅 payment (note mentions 關稅, no 主:子 tag, not a refund/退稅) ---
  const { data: customsRaw } = await s.from('transactions')
    .select('id, amount, transaction_at, tags, note').ilike('note', '%關稅%');
  const customs = ((customsRaw ?? []) as Tx[]).filter(
    (t) => !t.tags.some((x) => x.includes(':')) && !(t.note ?? '').includes('退稅'));

  console.log(`所得稅 records: ${incomeTx.length} tx-level, ${(incomeItems ?? []).length} item-level`);
  for (const t of incomeTx) console.log(`  tx ${t.id.slice(0, 8)} $${t.amount} ${t.transaction_at?.slice(0, 10)} tags=[${t.tags.join(', ')}] → [${retag(t.tags, '所得稅').join(', ')}]`);
  console.log(`\n關稅 untagged payment: ${customs.length}`);
  for (const t of customs) console.log(`  tx ${t.id.slice(0, 8)} $${t.amount} ${t.transaction_at?.slice(0, 10)} note="${t.note}" tags=[${t.tags.join(', ')}] → [${retag(t.tags, '關稅').join(', ')}]`);
  console.log('');

  if (!APPLY) {
    console.log('DRY RUN — no writes. Re-run with APPLY=1 to execute.\n');
    // Surface adjacent customs rows that are intentionally left alone, for the user's awareness.
    const skipped = ((customsRaw ?? []) as Tx[]).filter((t) => !customs.includes(t));
    if (skipped.length) {
      console.log('NOTE — 關稅-related rows left untouched (already categorized / refunds):');
      for (const t of skipped) console.log(`  tx ${t.id.slice(0, 8)} $${t.amount} ${t.transaction_at?.slice(0, 10)} tags=[${t.tags.join(', ')}] note="${t.note}"`);
    }
    return;
  }

  // --- APPLY ---
  if (!has稅金) {
    const { error } = await s.from('categories').upsert(
      { major: '其他', subcategory: '稅金', sort_order: 稅金Order }, { onConflict: 'major,subcategory' });
    if (error) throw new Error(`upsert 稅金: ${error.message}`);
    console.log(`✓ created 其他:稅金 (sort_order=${稅金Order})`);
  }
  for (const t of incomeTx) {
    const { error } = await s.from('transactions').update({ tags: retag(t.tags, '所得稅') }).eq('id', t.id);
    if (error) throw new Error(`tx ${t.id}: ${error.message}`);
  }
  for (const it of incomeItems ?? []) {
    const { error } = await s.from('transaction_items').update({ tags: retag((it as any).tags, '所得稅') }).eq('id', (it as any).id);
    if (error) throw new Error(`item ${(it as any).id}: ${error.message}`);
  }
  for (const t of customs) {
    const { error } = await s.from('transactions').update({ tags: retag(t.tags, '關稅') }).eq('id', t.id);
    if (error) throw new Error(`customs ${t.id}: ${error.message}`);
  }
  console.log(`✓ re-tagged ${incomeTx.length} 所得稅 tx, ${(incomeItems ?? []).length} 所得稅 item, ${customs.length} 關稅 tx`);

  const { error: delErr } = await s.from('categories').delete().eq('major', '其他').eq('subcategory', '所得稅');
  if (delErr) throw new Error(`delete 所得稅 catalog: ${delErr.message}`);
  console.log('✓ removed 其他:所得稅 from catalog\n');
}
main().catch((e) => { console.error(e); process.exit(1); });
