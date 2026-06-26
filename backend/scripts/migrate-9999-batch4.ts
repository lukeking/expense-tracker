#!/usr/bin/env tsx
/**
 * 9999-catalog cleanup, batch 4 — finish the 食 major (its 10 unranked subs).
 *
 * 正名 (assign a real sort_order, sub kept — slotted into gaps, no existing rows renumbered):
 *   食:早午餐  → 15    (brunch, between 早餐10/午餐20)
 *   食:點心    → 45    (kept distinct from 零食: 點心 is prepared 小吃, 零食 is packaged snacks)
 *   食:水果    → 55
 *   食:食材    → 105
 *   食:調味料  → 107
 *   食:其他    → 130   (food misc bucket, sorts last)
 *
 * Fold (sub retired, specific survives as a plain tag; existing notes preserved):
 *   食:酒精飲料      → 食:飲料     + tag 酒精飲料   (1 row)
 *   食:儲糧          → 食:補給     + tag 儲糧
 *   食:Uber Eats Pass → 食:Uber Eats + tag Pass
 *   食:Uber Eats Tips → 食:Uber Eats + tag Tips
 *
 * After this, 食 has zero sort_order=9999 subs.
 *
 * Idempotent. Read-only by default; set APPLY=1 to write.
 *   cd backend && npx tsx scripts/migrate-9999-batch4.ts          # dry run
 *            APPLY=1 npx tsx scripts/migrate-9999-batch4.ts       # execute
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.env.APPLY === '1';

type Item = { name: string | null };
type Tx = { id: string; amount: number; tags: string[]; note: string | null; transaction_items: Item[] };
type Move = { tx: Tx; from: string; to: string; addPlain: string[] };

const RANK: [string, number][] = [
  ['食:早午餐', 15], ['食:點心', 45], ['食:水果', 55], ['食:食材', 105], ['食:調味料', 107], ['食:其他', 130],
];
const FOLD: [string, string, string][] = [
  ['食:酒精飲料', '食:飲料', '酒精飲料'],
  ['食:儲糧', '食:補給', '儲糧'],
  ['食:Uber Eats Pass', '食:Uber Eats', 'Pass'],
  ['食:Uber Eats Tips', '食:Uber Eats', 'Tips'],
];
const RETIRE = FOLD.map(([from]) => from);

function rewrite(tags: string[], from: string, to: string, addPlain: string[]): string[] {
  const out = tags.filter((x) => x !== from);
  for (const x of [to, addPlain].flat()) if (!out.includes(x)) out.push(x);
  return out;
}

async function main() {
  console.log(`\n=== migrate-9999-batch4 (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
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
  for (const [from, to, tag] of FOLD)
    for (const t of rows(from)) moves.push({ tx: t, from, to, addPlain: [tag] });

  console.log('正名 (sort_order only, sub kept):');
  for (const [cat, ord] of RANK) console.log(`   ${cat}  ${rows(cat).length} row(s)  → sort_order ${ord}`);
  console.log('');

  for (const [from] of FOLD) {
    const g = moves.filter((m) => m.from === from);
    console.log(`【${from}】 ${g.length} row(s) — fold`);
    for (const m of g) {
      const nt = rewrite(m.tx.tags, m.from, m.to, m.addPlain);
      const name = m.tx.transaction_items.map((i) => i.name ?? '?').join(', ');
      console.log(`   $${m.tx.amount} ${name}\n      [${m.tx.tags.join(', ')}] → [${nt.join(', ')}]`);
    }
    console.log('');
  }

  console.log(`catalog: rank ${RANK.map(([c, o]) => `${c}=${o}`).join(', ')}`);
  console.log(`         retire ${RETIRE.length}: ${RETIRE.join(', ')}\n`);

  if (!APPLY) { console.log('DRY RUN — no writes. Re-run with APPLY=1 to execute.\n'); return; }

  for (const m of moves) {
    const { error } = await s.from('transactions').update({ tags: rewrite(m.tx.tags, m.from, m.to, m.addPlain) }).eq('id', m.tx.id);
    if (error) throw new Error(`tx ${m.tx.id}: ${error.message}`);
  }
  console.log(`✓ re-tagged ${moves.length} rows`);

  for (const [cat, ord] of RANK) {
    const [major, subcategory] = cat.split(':');
    const { error } = await s.from('categories').upsert({ major, subcategory, sort_order: ord }, { onConflict: 'major,subcategory' });
    if (error) throw new Error(`rank ${cat}: ${error.message}`);
  }
  console.log(`✓ ranked ${RANK.length} subs`);

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
