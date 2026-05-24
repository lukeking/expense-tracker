#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // Fetch valid category pairs
  const { data: cats } = await supabase.from('categories').select('major, subcategory');
  const validPairs = new Set((cats ?? []).map((c: any) => `${c.major}:${c.subcategory}`));

  // Print category tree
  const subcatsByCat: Record<string, string[]> = {};
  for (const c of (cats ?? [])) {
    if (!subcatsByCat[c.major]) subcatsByCat[c.major] = [];
    subcatsByCat[c.major].push(c.subcategory);
  }
  console.log('\n=== Valid categories ===');
  for (const [major, subs] of Object.entries(subcatsByCat).sort()) {
    console.log(`  ${major}: ${subs.sort().join(', ')}`);
  }

  // Fetch all transaction_items with category tags
  const PAGE = 1000;
  const all: any[] = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from('transaction_items')
      .select('id, transaction_id, name, tags')
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  const CAT_TAG_RE = /^[^:]+:[^:]+$/;
  const orphans = all.filter((i: any) =>
    (i.tags || []).some((t: string) => CAT_TAG_RE.test(t) && !validPairs.has(t))
  );

  console.log(`\n=== Orphan category tag items (${orphans.length} total) ===`);
  const tagSet = new Set<string>();
  for (const item of orphans) {
    const orphanTags = (item.tags || []).filter((t: string) => CAT_TAG_RE.test(t) && !validPairs.has(t));
    for (const t of orphanTags) tagSet.add(t);
    console.log(`  name="${item.name}" orphan_tags=${JSON.stringify(orphanTags)}`);
  }

  console.log(`\n=== Unique orphan tags (${tagSet.size}) ===`);
  for (const t of [...tagSet].sort()) console.log(`  "${t}"`);

  // Fetch items_sum_mismatch rows
  console.log('\n=== items_sum_mismatch rows ===');
  const txIds = [
    'cb772668-4d02-468c-91f2-43af765eb701',
    'cec033ff-462d-45fb-ab07-87a2c036c6c1',
  ];
  for (const txId of txIds) {
    const { data: tx } = await supabase.from('transactions').select('id, amount, note, transaction_at').eq('id', txId).single();
    const { data: items } = await supabase.from('transaction_items').select('id, name, amount, sort_order').eq('transaction_id', txId).order('sort_order');
    console.log(`  tx ${txId} amount=${tx?.amount} note="${tx?.note}" at=${tx?.transaction_at}`);
    for (const i of (items ?? [])) {
      console.log(`    item id=${i.id} name="${i.name}" amount=${i.amount} sort_order=${i.sort_order}`);
    }
  }
}

main().catch(console.error);
