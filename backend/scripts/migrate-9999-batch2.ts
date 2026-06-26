#!/usr/bin/env tsx
/**
 * 9999-catalog cleanup, batch 2 — the over-granular one-offs under 樂. 樂 has no misc
 * bucket, so we create one (樂:其他, parallel to 食:其他) to keep these counted as leisure,
 * with the specific thing surviving as a plain tag. 攝影 is pulled out to its own sub
 * under 其他 instead, with its camera-bag detail demoted from tag to note.
 *
 *   樂:VPN    → 樂:其他 + tag VPN
 *   樂:玩具    → 樂:其他 + tag 玩具      (keeps the existing plushie-name tag)
 *   樂:動畫瘋  → 樂:其他 + tag 動畫瘋
 *   樂:漫畫店  → 樂:其他 + tag 漫畫店
 *   樂:KTV    → 樂:其他 + tag KTV
 *   樂:攝影    → 其他:攝影  (drop the 相機包 tag; set note=相機包)
 *
 * Creates 樂:其他 (sorts last within 樂) and 其他:攝影 (real sort_order under 其他).
 * Retires 6 catalog subs (deleted only after their records carry no such tag).
 *
 * Idempotent. Read-only by default; set APPLY=1 to write.
 *   cd backend && npx tsx scripts/migrate-9999-batch2.ts          # dry run
 *            APPLY=1 npx tsx scripts/migrate-9999-batch2.ts       # execute
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const APPLY = process.env.APPLY === '1';

type Item = { name: string | null };
type Tx = { id: string; amount: number; tags: string[]; note: string | null; transaction_items: Item[] };
type Move = { tx: Tx; from: string; to: string; addPlain: string[]; dropTags?: string[]; setNote?: string };

const RETIRE = ['樂:VPN', '樂:玩具', '樂:動畫瘋', '樂:漫畫店', '樂:KTV', '樂:攝影'];

function rewrite(tags: string[], m: Move): string[] {
  const drop = new Set([m.from, ...(m.dropTags ?? [])]);
  const out = tags.filter((x) => !drop.has(x));
  for (const x of [m.to, ...m.addPlain]) if (!out.includes(x)) out.push(x);
  return out;
}

async function main() {
  console.log(`\n=== migrate-9999-batch2 (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
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
  for (const t of rows('樂:VPN')) moves.push({ tx: t, from: '樂:VPN', to: '樂:其他', addPlain: ['VPN'] });
  for (const t of rows('樂:玩具')) moves.push({ tx: t, from: '樂:玩具', to: '樂:其他', addPlain: ['玩具'] });
  for (const t of rows('樂:動畫瘋')) moves.push({ tx: t, from: '樂:動畫瘋', to: '樂:其他', addPlain: ['動畫瘋'] });
  for (const t of rows('樂:漫畫店')) moves.push({ tx: t, from: '樂:漫畫店', to: '樂:其他', addPlain: ['漫畫店'] });
  for (const t of rows('樂:KTV')) moves.push({ tx: t, from: '樂:KTV', to: '樂:其他', addPlain: ['KTV'] });
  for (const t of rows('樂:攝影'))
    moves.push({ tx: t, from: '樂:攝影', to: '其他:攝影', addPlain: [], dropTags: ['相機包'], setNote: '相機包' });

  // print grouped by source
  for (const cat of RETIRE) {
    const g = moves.filter((m) => m.from === cat);
    console.log(`【${cat}】 ${g.length} row(s)`);
    for (const m of g) {
      const nt = rewrite(m.tx.tags, m);
      const name = m.tx.transaction_items.map((i) => i.name ?? '?').join(', ');
      const noteChange = m.setNote ? `  note: ${m.tx.note ?? '∅'} → ${m.setNote}` : '';
      console.log(`   $${m.tx.amount} ${name}\n      [${m.tx.tags.join(', ')}] → [${nt.join(', ')}]${noteChange}`);
    }
    console.log('');
  }

  // catalog: sort_order for the two new subs (each sorts after its major's ranked subs)
  const { data: cats } = await s.from('categories').select('major, subcategory, sort_order');
  const ranked = (major: string) => Math.max(0, ...(cats ?? [])
    .filter((c) => c.major === major && (c.sort_order ?? 9999) < 9999).map((c) => c.sort_order as number));
  const has = (major: string, sub: string) => (cats ?? []).some((c) => c.major === major && c.subcategory === sub);
  const leOrder = ranked('樂') + 10;
  const qtOrder = ranked('其他') + 10;
  console.log(`catalog: ${has('樂', '其他') ? 'keep' : 'create'} 樂:其他 (sort_order=${leOrder}); ` +
    `${has('其他', '攝影') ? 'keep' : 'create'} 其他:攝影 (sort_order=${qtOrder})`);
  console.log(`         retire ${RETIRE.length}: ${RETIRE.join(', ')}\n`);

  if (!APPLY) { console.log('DRY RUN — no writes. Re-run with APPLY=1 to execute.\n'); return; }

  for (const m of moves) {
    const patch: { tags: string[]; note?: string } = { tags: rewrite(m.tx.tags, m) };
    if (m.setNote && !m.tx.note) patch.note = m.setNote;
    const { error } = await s.from('transactions').update(patch).eq('id', m.tx.id);
    if (error) throw new Error(`tx ${m.tx.id}: ${error.message}`);
  }
  console.log(`✓ re-tagged ${moves.length} rows`);

  if (!has('樂', '其他')) {
    const { error } = await s.from('categories').upsert({ major: '樂', subcategory: '其他', sort_order: leOrder }, { onConflict: 'major,subcategory' });
    if (error) throw new Error(`upsert 樂:其他: ${error.message}`);
    console.log(`✓ created 樂:其他 (sort_order=${leOrder})`);
  }
  if (!has('其他', '攝影')) {
    const { error } = await s.from('categories').upsert({ major: '其他', subcategory: '攝影', sort_order: qtOrder }, { onConflict: 'major,subcategory' });
    if (error) throw new Error(`upsert 其他:攝影: ${error.message}`);
    console.log(`✓ created 其他:攝影 (sort_order=${qtOrder})`);
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
