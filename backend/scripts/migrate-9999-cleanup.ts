#!/usr/bin/env tsx
/**
 * 9999-catalog cleanup, batch 1 — fold over-granular subs into broader buckets, with the
 * specific thing surviving as a plain tag (same shape as the 稅金 merge). Also fixes 3
 * misclassified rows surfaced while reviewing.
 *
 *   其他:電池        → 其他:日用品 + tag 電池
 *   其他:修拉鏈      ┐ new 衣:修補保養 + tag 修拉鏈 / 洗鞋  (collapses two subs into one)
 *   衣:洗鞋          ┘
 *   其他:影印        → 其他:雜支 + tag 影印
 *   其他:證件照      → 其他:雜支 + tag 證件照
 *   其他:置物櫃      → 其他:雜支 + tag 置物櫃   (locker rows)
 *                    ↳ 太歲燈 $500 row is misfiled (宗教, not a locker) → 其他:雜支 + tag 宗教
 *   其他:信用卡      → 其他:雜支   (Line貼圖 row → + tag 貼圖, redundant "信用卡)" prefix;
 *                                  the two bare 信用卡 rows → no extra tag)
 *   其他:Google Play → 樂:遊戲     (去廣告 row → + tag IAP; rest as-is)
 *
 * Retires 8 catalog subs (deleted only after their records carry no such tag). 其他:煤油 and
 * 其他:雜支 are intentionally left untouched.
 *
 * Idempotent. Read-only by default; set APPLY=1 to write.
 *   cd backend && npx tsx scripts/migrate-9999-cleanup.ts          # dry run
 *            APPLY=1 npx tsx scripts/migrate-9999-cleanup.ts       # execute
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.env.APPLY === '1';

type Item = { name: string | null };
type Tx = { id: string; amount: number; tags: string[]; note: string | null; transaction_items: Item[] };
type Move = { tx: Tx; from: string; to: string; addPlain: string[] };

const RETIRE = ['其他:電池', '其他:修拉鏈', '衣:洗鞋', '其他:影印', '其他:證件照', '其他:置物櫃', '其他:信用卡', '其他:Google Play'];

const text = (t: Tx) => `${t.transaction_items.map((i) => i.name ?? '').join(' ')} ${t.note ?? ''}`;
function rewrite(tags: string[], from: string, to: string, addPlain: string[]): string[] {
  const out = tags.filter((x) => x !== from);
  for (const x of [to, ...addPlain]) if (!out.includes(x)) out.push(x);
  return out;
}

async function main() {
  console.log(`\n=== migrate-9999-cleanup batch 1 (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const all: Tx[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s.from('transactions')
      .select('id, amount, tags, note, transaction_items(name)').range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as unknown as Tx[]));
    if ((data ?? []).length < 1000) break;
  }
  const rows = (cat: string) => all.filter((t) => (t.tags ?? []).includes(cat));

  const moves: Move[] = [];
  for (const t of rows('其他:電池')) moves.push({ tx: t, from: '其他:電池', to: '其他:日用品', addPlain: ['電池'] });
  for (const t of rows('其他:修拉鏈')) moves.push({ tx: t, from: '其他:修拉鏈', to: '衣:修補保養', addPlain: ['修拉鏈'] });
  for (const t of rows('衣:洗鞋')) moves.push({ tx: t, from: '衣:洗鞋', to: '衣:修補保養', addPlain: ['洗鞋'] });
  for (const t of rows('其他:影印')) moves.push({ tx: t, from: '其他:影印', to: '其他:雜支', addPlain: ['影印'] });
  for (const t of rows('其他:證件照')) moves.push({ tx: t, from: '其他:證件照', to: '其他:雜支', addPlain: ['證件照'] });
  for (const t of rows('其他:置物櫃'))
    moves.push(text(t).includes('太歲燈')
      ? { tx: t, from: '其他:置物櫃', to: '其他:雜支', addPlain: ['宗教'] }
      : { tx: t, from: '其他:置物櫃', to: '其他:雜支', addPlain: ['置物櫃'] });
  for (const t of rows('其他:信用卡'))
    moves.push(text(t).includes('貼圖')
      ? { tx: t, from: '其他:信用卡', to: '其他:雜支', addPlain: ['貼圖'] }
      : { tx: t, from: '其他:信用卡', to: '其他:雜支', addPlain: [] });
  for (const t of rows('其他:Google Play'))
    moves.push(text(t).includes('去廣告')
      ? { tx: t, from: '其他:Google Play', to: '樂:遊戲', addPlain: ['IAP'] }
      : { tx: t, from: '其他:Google Play', to: '樂:遊戲', addPlain: [] });

  // print grouped by source
  for (const cat of RETIRE) {
    const g = moves.filter((m) => m.from === cat);
    console.log(`【${cat}】 ${g.length} row(s)`);
    for (const m of g) {
      const nt = rewrite(m.tx.tags, m.from, m.to, m.addPlain);
      const name = m.tx.transaction_items.map((i) => i.name ?? '?').join(', ');
      console.log(`   $${m.tx.amount} ${name}\n      [${m.tx.tags.join(', ')}] → [${nt.join(', ')}]`);
    }
    console.log('');
  }

  // catalog: pick a sort_order for the new 衣:修補保養
  const { data: cats } = await s.from('categories').select('major, subcategory, sort_order');
  const has修補 = (cats ?? []).some((c) => c.major === '衣' && c.subcategory === '修補保養');
  const yiMax = Math.max(0, ...(cats ?? []).filter((c) => c.major === '衣' && (c.sort_order ?? 9999) < 9999).map((c) => c.sort_order as number));
  const 修補Order = yiMax + 10;
  console.log(`catalog: ${has修補 ? 'keep' : 'create'} 衣:修補保養 (sort_order=${修補Order}); retire ${RETIRE.length}: ${RETIRE.join(', ')}\n`);

  if (!APPLY) { console.log('DRY RUN — no writes. Re-run with APPLY=1 to execute.\n'); return; }

  for (const m of moves) {
    const { error } = await s.from('transactions').update({ tags: rewrite(m.tx.tags, m.from, m.to, m.addPlain) }).eq('id', m.tx.id);
    if (error) throw new Error(`tx ${m.tx.id}: ${error.message}`);
  }
  console.log(`✓ re-tagged ${moves.length} rows`);

  if (!has修補) {
    const { error } = await s.from('categories').upsert({ major: '衣', subcategory: '修補保養', sort_order: 修補Order }, { onConflict: 'major,subcategory' });
    if (error) throw new Error(`upsert 修補保養: ${error.message}`);
    console.log(`✓ created 衣:修補保養 (sort_order=${修補Order})`);
  }

  // delete retired catalog rows, guarded by a 0-usage recount from the live DB
  const { data: after } = await s.from('transactions').select('tags');
  const stillUsed = new Set<string>();
  for (const r of after ?? []) for (const tag of (r as any).tags ?? []) stillUsed.add(tag);
  for (const cat of RETIRE) {
    if (stillUsed.has(cat)) { console.warn(`SKIP delete ${cat} — still used`); continue; }
    const [major, subcategory] = cat.split(':');
    const { error } = await s.from('categories').delete().eq('major', major).eq('subcategory', subcategory);
    if (error) throw new Error(`delete ${cat}: ${error.message}`);
  }
  console.log(`✓ retired catalog subs\n`);
}
main().catch((e) => { console.error(e); process.exit(1); });
