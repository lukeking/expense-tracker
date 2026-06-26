#!/usr/bin/env tsx
/**
 * Read-only inspector: dump every transaction carrying one of the given category tags,
 * so a fold/正名 decision can be made from the actual rows. No writes, ever.
 *
 *   cd backend && npx tsx scripts/inspect-categories.ts 樂:VPN 樂:玩具 樂:KTV
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const s = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const targets = process.argv.slice(2);
if (targets.length === 0) { console.error('usage: inspect-categories.ts <cat> [cat...]'); process.exit(1); }

type Item = { name: string | null };
type Tx = { id: string; amount: number; tags: string[]; note: string | null; transaction_at: string; transaction_items: Item[] };

async function main() {
  const all: Tx[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await s.from('transactions')
      .select('id, amount, tags, note, transaction_at, transaction_items(name)').range(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...((data ?? []) as unknown as Tx[]));
    if ((data ?? []).length < 1000) break;
  }
  for (const cat of targets) {
    const rows = all.filter((t) => (t.tags ?? []).includes(cat));
    console.log(`\n【${cat}】 ${rows.length} row(s)`);
    for (const t of rows) {
      const name = t.transaction_items.map((i) => i.name ?? '?').join(', ') || '(no items)';
      const date = t.transaction_at?.slice(0, 10) ?? '?';
      console.log(`   ${date}  $${t.amount}  ${name}`);
      console.log(`      tags=[${(t.tags ?? []).join(', ')}]${t.note ? `  note=${t.note}` : ''}`);
    }
  }
  console.log('');
}
main().catch((e) => { console.error(e); process.exit(1); });
