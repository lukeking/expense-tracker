#!/usr/bin/env tsx
/**
 * Audit script: surfaces transaction/items anomalies left by the legacy CSV migration.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/audit-legacy.ts [--source <name>]
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env
 */

// -- Imports/env --

import * as fs from 'fs';
import * as path from 'path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[audit] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

// Path to report output dir — resolved relative to CWD (expected: backend/).
const REPORT_DIR = path.resolve(process.cwd(), '../specs/015-legacy-audit-catalog/audit-reports');
const KNOWN_SOURCES = new Set(['legacy_migration', 'discord', 'pwa', 'invoice', 'android']);

// -- Types --

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<any>;

interface CheckContext {
  supabase: Supabase;
  sourceFilter: string | null;
}

interface CheckResult {
  name: string;
  description: string;
  kind: 'invariant' | 'sampler';
  count: number;
  samples: Record<string, unknown>[];
  suggestedTool: 'bulk' | 'case-by-case' | 'inspect-only';
}

type Check = (ctx: CheckContext) => Promise<CheckResult>;

interface AuditReportSidecar {
  schemaVersion: 1;
  generatedAt: string;
  sourceFilter: string | null;
  totalTransactionsScanned: number;
  checks: Record<string, {
    count: number;
    kind: 'invariant' | 'sampler';
    suggestedTool: 'bulk' | 'case-by-case' | 'inspect-only';
    description: string;
    errored: boolean;
  }>;
}

interface DiffEntry {
  name: string;
  kind: 'invariant' | 'sampler';
  prior: number | null;
  current: number | null;
}

// -- Check helpers --

function takeSample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const result = arr.slice();
  for (let i = result.length - 1; i > result.length - 1 - n; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(result.length - n);
}

// Paginate through all rows, bypassing PostgREST's default 1000-row cap.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAll(makeQuery: () => any): Promise<any[]> {
  const PAGE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  let from = 0;
  for (;;) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (makeQuery() as any).range(from, from + PAGE - 1);
    if (error) throw new Error((error as { message: string }).message);
    if (!data || (data as unknown[]).length === 0) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    all.push(...(data as any[]));
    if ((data as unknown[]).length < PAGE) break;
    from += PAGE;
  }
  return all;
}

// Matches <major>:<subcategory> category tag format.
const CAT_TAG_RE = /^[^:]+:[^:]+$/;

// -- Checks --

const checkTransactionsWithoutItems: Check = async ({ supabase, sourceFilter }) => {
  // Client-side anti-join: collect all transaction_ids that DO have items,
  // then filter transactions to those absent from that set.
  type TxRow = { id: string; amount: number; source: string | null; transaction_at: string; note: string | null };
  type ItemRef = { transaction_id: string };

  const [allTxs, allItemRefs] = await Promise.all([
    fetchAll(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = supabase.from('transactions').select('id, amount, source, transaction_at, note');
      if (sourceFilter) q = q.eq('source', sourceFilter);
      return q;
    }) as Promise<TxRow[]>,
    fetchAll(() => supabase.from('transaction_items').select('transaction_id')) as Promise<ItemRef[]>,
  ]);

  const txIdsWithItems = new Set(allItemRefs.map(r => r.transaction_id));
  const withoutItems = allTxs.filter(t => !txIdsWithItems.has(t.id));

  return {
    name: 'invariant.transactions_without_items',
    description: 'Transactions that have zero corresponding transaction_items rows.',
    kind: 'invariant',
    count: withoutItems.length,
    samples: takeSample(withoutItems, 5).map(t => ({
      transaction_id: t.id,
      amount: t.amount,
      source: t.source,
      transaction_at: t.transaction_at,
      note: t.note,
    })),
    suggestedTool: 'bulk',
  };
};

const checkItemsSumMismatch: Check = async ({ supabase, sourceFilter }) => {
  // Fetch all transactions with their items to compute sums client-side.
  type TxRow = { id: string; amount: number; source: string; transaction_at: string; note: string | null; transaction_items: Array<{ amount: number | null }> };
  const txs = (await fetchAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from('transactions').select('id, amount, source, transaction_at, note, transaction_items(amount)');
    if (sourceFilter) q = q.eq('source', sourceFilter);
    return q;
  })) as TxRow[];

  const mismatches = txs.filter(t => {
    const items = t.transaction_items ?? [];
    if (items.length === 0) return false;
    if (items.some(i => i.amount === null)) return false;
    const sum = items.reduce((s, i) => s + (i.amount as number), 0);
    return sum !== t.amount;
  });

  const samples = takeSample(mismatches, 5).map(t => {
    const itemsSum = t.transaction_items.reduce((s, i) => s + (i.amount as number), 0);
    return {
      transaction_id: t.id,
      transaction_amount: t.amount,
      items_sum: itemsSum,
      delta: itemsSum - t.amount,
      source: t.source,
      transaction_at: t.transaction_at,
    };
  });

  return {
    name: 'invariant.items_sum_mismatch',
    description: 'Transactions where every item has a non-null amount and SUM(item.amount) ≠ transaction.amount.',
    kind: 'invariant',
    count: mismatches.length,
    samples,
    suggestedTool: 'case-by-case',
  };
};

const checkFeeRefundWithoutParent: Check = async ({ supabase, sourceFilter }) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = supabase
    .from('transactions')
    .select('id, amount, source, transaction_at, note, transaction_type, parent_transaction_id', { count: 'exact' })
    .in('transaction_type', ['fee', 'refund'])
    .is('parent_transaction_id', null)
    .limit(200);
  if (sourceFilter) q = q.eq('source', sourceFilter);
  const { data, count: countRaw, error } = await q;
  if (error) throw new Error((error as { message: string }).message);

  const pool = (data ?? []).map((t: Record<string, unknown>) => ({
    transaction_id: t['id'],
    transaction_type: t['transaction_type'],
    amount: t['amount'],
    source: t['source'],
    transaction_at: t['transaction_at'],
    note: t['note'],
  }));

  return {
    name: 'invariant.fee_refund_without_parent',
    description: 'fee/refund transactions whose parent_transaction_id is NULL.',
    kind: 'invariant',
    count: (countRaw as number | null) ?? 0,
    samples: takeSample(pool, 5),
    suggestedTool: 'bulk',
  };
};

const checkOrphanParentReference: Check = async ({ supabase, sourceFilter }) => {
  // Collect all valid transaction IDs first (paginated).
  const allIdRows = await fetchAll(() => supabase.from('transactions').select('id'));
  const validIds = new Set(allIdRows.map((r: Record<string, unknown>) => r['id'] as string));

  // Get transactions with non-null parent_transaction_id (paginated, with sourceFilter).
  type TxRow = { id: string; amount: number; source: string; transaction_at: string; note: string | null; parent_transaction_id: string };
  const txsWithParent = (await fetchAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from('transactions').select('id, amount, source, transaction_at, note, parent_transaction_id').not('parent_transaction_id', 'is', null);
    if (sourceFilter) q = q.eq('source', sourceFilter);
    return q;
  })) as TxRow[];

  const orphans = txsWithParent.filter(t => !validIds.has(t.parent_transaction_id));

  const samples = takeSample(orphans, 5).map(t => ({
    transaction_id: t.id,
    parent_transaction_id: t.parent_transaction_id,
    amount: t.amount,
    source: t.source,
    transaction_at: t.transaction_at,
  }));

  return {
    name: 'invariant.orphan_parent_reference',
    description: 'Transactions whose parent_transaction_id does not resolve to any existing transactions.id.',
    kind: 'invariant',
    count: orphans.length,
    samples,
    suggestedTool: 'case-by-case',
  };
};

const checkCategoryTagOnTransaction: Check = async ({ supabase, sourceFilter }) => {
  type TxRow = { id: string; amount: number; source: string; transaction_at: string; note: string | null; tags: string[] | null };
  const allTxs = (await fetchAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from('transactions').select('id, amount, source, transaction_at, note, tags');
    if (sourceFilter) q = q.eq('source', sourceFilter);
    return q;
  })) as TxRow[];

  const withCatTag = allTxs.filter(t =>
    (t.tags ?? []).some(tag => CAT_TAG_RE.test(tag))
  );

  const samples = takeSample(withCatTag, 5).map(t => ({
    transaction_id: t.id,
    source: t.source,
    tags: t.tags,
    category_tags: (t.tags ?? []).filter(tag => CAT_TAG_RE.test(tag)),
  }));

  return {
    name: 'invariant.category_tag_on_transaction',
    description: 'Transactions whose tags array contains <major>:<subcategory> elements that should live only on items.',
    kind: 'invariant',
    count: withCatTag.length,
    samples,
    suggestedTool: 'bulk',
  };
};

const checkOrphanCategoryTagOnItem: Check = async ({ supabase, sourceFilter }) => {
  const { data: cats, error: catErr } = await supabase
    .from('categories')
    .select('major, subcategory');
  if (catErr) throw new Error(catErr.message);
  const validPairs = new Set((cats ?? []).map((c: Record<string, unknown>) => `${c['major']}:${c['subcategory']}`));

  const items = await fetchAll(() => {
    if (sourceFilter) {
      return supabase
        .from('transaction_items')
        .select('id, transaction_id, name, amount, tags, transactions!inner(source)')
        .eq('transactions.source', sourceFilter);
    }
    return supabase.from('transaction_items').select('id, transaction_id, name, amount, tags');
  });

  type ItemRow = { id: string; transaction_id: string; name: string | null; amount: number | null; tags: string[] | null };
  const orphanItems = ((items ?? []) as ItemRow[]).filter(item => {
    const catTags = (item.tags ?? []).filter(t => CAT_TAG_RE.test(t));
    return catTags.some(t => !validPairs.has(t));
  });

  const samples = takeSample(orphanItems, 5).map(item => ({
    item_id: item.id,
    transaction_id: item.transaction_id,
    name: item.name,
    orphan_tags: (item.tags ?? []).filter(t => CAT_TAG_RE.test(t) && !validPairs.has(t)),
  }));

  return {
    name: 'invariant.orphan_category_tag_on_item',
    description: 'transaction_items whose <major>:<subcategory> tags are not present in the categories table.',
    kind: 'invariant',
    count: orphanItems.length,
    samples,
    suggestedTool: 'case-by-case',
  };
};

const samplerTransactionsByShape: Check = async ({ supabase, sourceFilter }) => {
  type TxRow = { id: string; note: string | null; tags: string[] | null; transaction_items: Array<{ id: string }> };
  const txs = (await fetchAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from('transactions').select('id, note, tags, transaction_items(id)');
    if (sourceFilter) q = q.eq('source', sourceFilter);
    return q;
  })) as TxRow[];
  type Bucket = '0' | '1' | '2-3' | '4+';
  const bucketMap = new Map<string, { has_note: boolean; items_count_bucket: Bucket; has_plain_tags: boolean; count: number }>();

  for (const tx of txs) {
    const has_note = !!(tx.note && tx.note.trim().length > 0);
    const itemCount = (tx.transaction_items ?? []).length;
    const items_count_bucket: Bucket = itemCount === 0 ? '0' : itemCount === 1 ? '1' : itemCount <= 3 ? '2-3' : '4+';
    const has_plain_tags = (tx.tags ?? []).some(t => !CAT_TAG_RE.test(t));
    const key = `${String(has_note)}|${items_count_bucket}|${String(has_plain_tags)}`;
    const existing = bucketMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      bucketMap.set(key, { has_note, items_count_bucket, has_plain_tags, count: 1 });
    }
  }

  const samples = [...bucketMap.values()]
    .sort((a, b) => b.count - a.count)
    .map(b => ({
      has_note: b.has_note,
      items_count_bucket: b.items_count_bucket,
      has_plain_tags: b.has_plain_tags,
      count: b.count,
    }));

  return {
    name: 'sampler.transactions_by_shape',
    description: 'Transactions grouped by shape: (has_note × items_count_bucket × has_plain_tags).',
    kind: 'sampler',
    count: txs.length,
    samples,
    suggestedTool: 'inspect-only',
  };
};

const samplerTransactionsBySource: Check = async ({ supabase, sourceFilter }) => {
  // Fetch all transactions (paginated) with fields needed for FR-009 through FR-013.
  type TxRow = { id: string; source: string | null; amount: number; transaction_type: string | null; parent_transaction_id: string | null; tags: string[] | null };
  const txs = (await fetchAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from('transactions').select('id, source, amount, transaction_type, parent_transaction_id, tags');
    if (sourceFilter) q = q.eq('source', sourceFilter);
    return q;
  })) as TxRow[];
  const allTxIds = new Set(txs.map(t => t.id));

  // Fetch all items (paginated): transaction_id + amount for FR-009 and FR-010.
  type ItemRef = { transaction_id: string; amount: number | null };
  const itemsRaw = (await fetchAll(() =>
    supabase.from('transaction_items').select('transaction_id, amount')
  )) as ItemRef[];

  const itemsByTx = new Map<string, Array<{ amount: number | null }>>();
  for (const item of itemsRaw) {
    const existing = itemsByTx.get(item.transaction_id) ?? [];
    existing.push({ amount: item.amount });
    itemsByTx.set(item.transaction_id, existing);
  }

  type SourceEntry = { total: number; no_items: number; sum_mismatch: number; fee_no_parent: number; orphan_parent: number; cat_tag_on_tx: number };
  const sourceMap = new Map<string, SourceEntry>();

  for (const tx of txs) {
    const src = tx.source ?? '(unknown)';
    const entry = sourceMap.get(src) ?? { total: 0, no_items: 0, sum_mismatch: 0, fee_no_parent: 0, orphan_parent: 0, cat_tag_on_tx: 0 };
    entry.total++;

    const txItems = itemsByTx.get(tx.id) ?? [];
    if (txItems.length === 0) entry.no_items++;

    if (txItems.length > 0 && txItems.every(i => i.amount !== null)) {
      const sum = txItems.reduce((s, i) => s + (i.amount as number), 0);
      if (sum !== tx.amount) entry.sum_mismatch++;
    }

    if (['fee', 'refund'].includes(tx.transaction_type ?? '') && tx.parent_transaction_id === null) entry.fee_no_parent++;
    if (tx.parent_transaction_id !== null && !allTxIds.has(tx.parent_transaction_id)) entry.orphan_parent++;
    if ((tx.tags ?? []).some(t => CAT_TAG_RE.test(t))) entry.cat_tag_on_tx++;

    sourceMap.set(src, entry);
  }

  const samples = [...sourceMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([source, s]) => ({
      source,
      total: s.total,
      no_items: s.no_items,
      sum_mismatch: s.sum_mismatch,
      fee_no_parent: s.fee_no_parent,
      orphan_parent: s.orphan_parent,
      cat_tag_on_tx: s.cat_tag_on_tx,
    }));

  return {
    name: 'sampler.transactions_by_source',
    description: 'Transactions grouped by source with per-source counts for invariant violations (FR-009 through FR-013).',
    kind: 'sampler',
    count: txs.length,
    samples,
    suggestedTool: 'inspect-only',
  };
};

const samplerLongestNotes: Check = async ({ supabase, sourceFilter }) => {
  type TxRow = { id: string; note: string; source: string; amount: number; transaction_at: string };
  const all = (await fetchAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from('transactions').select('id, note, source, amount, transaction_at').not('note', 'is', null).not('note', 'eq', '');
    if (sourceFilter) q = q.eq('source', sourceFilter);
    return q;
  })) as TxRow[];

  const samples = all
    .sort((a, b) => b.note.length - a.note.length)
    .slice(0, 20)
    .map(t => ({
      transaction_id: t.id,
      note_length: t.note.length,
      note_preview: t.note.slice(0, 200),
      source: t.source,
      amount: t.amount,
      transaction_at: t.transaction_at,
    }));

  return {
    name: 'sampler.longest_notes',
    description: 'Top 20 transactions ordered by LENGTH(note) descending.',
    kind: 'sampler',
    count: all.length,
    samples,
    suggestedTool: 'inspect-only',
  };
};

const samplerLongestTagsArrays: Check = async ({ supabase, sourceFilter }) => {
  type TxRow = { id: string; tags: string[]; source: string; amount: number; transaction_at: string };
  const all = (await fetchAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase.from('transactions').select('id, tags, source, amount, transaction_at').not('tags', 'is', null);
    if (sourceFilter) q = q.eq('source', sourceFilter);
    return q;
  })) as TxRow[];

  const samples = all
    .filter(t => Array.isArray(t.tags) && t.tags.length > 0)
    .sort((a, b) => b.tags.length - a.tags.length)
    .slice(0, 20)
    .map(t => ({
      transaction_id: t.id,
      tags_count: t.tags.length,
      tags: t.tags,
      source: t.source,
      amount: t.amount,
    }));

  return {
    name: 'sampler.longest_tags_arrays',
    description: 'Top 20 transactions ordered by tags array length descending.',
    kind: 'sampler',
    count: all.length,
    samples,
    suggestedTool: 'inspect-only',
  };
};

const samplerLongestItemNames: Check = async ({ supabase, sourceFilter }) => {
  type ItemRow = { id: string; transaction_id: string; name: string | null; amount: number | null };
  const all = (await fetchAll(() => {
    if (sourceFilter) {
      return supabase
        .from('transaction_items')
        .select('id, transaction_id, name, amount, transactions!inner(source)')
        .eq('transactions.source', sourceFilter);
    }
    return supabase.from('transaction_items').select('id, transaction_id, name, amount');
  })) as ItemRow[];

  const samples = all
    .filter(i => i.name && i.name.length > 0)
    .sort((a, b) => (b.name ?? '').length - (a.name ?? '').length)
    .slice(0, 20)
    .map(i => ({
      item_id: i.id,
      transaction_id: i.transaction_id,
      name_length: (i.name ?? '').length,
      name: i.name,
      amount: i.amount,
    }));

  return {
    name: 'sampler.longest_item_names',
    description: 'Top 20 transaction_items ordered by LENGTH(name) descending.',
    kind: 'sampler',
    count: all.length,
    samples,
    suggestedTool: 'inspect-only',
  };
};

// -- Runner --

const CHECKS: Check[] = [
  checkTransactionsWithoutItems,
  checkItemsSumMismatch,
  checkFeeRefundWithoutParent,
  checkOrphanParentReference,
  checkCategoryTagOnTransaction,
  checkOrphanCategoryTagOnItem,
  samplerTransactionsByShape,
  samplerTransactionsBySource,
  samplerLongestNotes,
  samplerLongestTagsArrays,
  samplerLongestItemNames,
];

async function runChecks(ctx: CheckContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of CHECKS) {
    const start = Date.now();
    process.stdout.write(`[audit] running ${check.name}...\n`);
    let result: CheckResult;
    try {
      result = await check(ctx);
      const elapsed = Date.now() - start;
      const label = result.kind === 'sampler' ? 'considered' : 'matches';
      console.log(`[audit]   ✓ ${result.name}: ${result.count} ${label} (${elapsed}ms)`);
    } catch (err) {
      const elapsed = Date.now() - start;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[audit]   ✗ ${check.name}: ERROR (${elapsed}ms) — ${msg}`);
      // Synthesise an error sentinel; name falls back to function name since we have no result.
      result = {
        name: check.name,
        description: `ERROR: ${msg}`,
        kind: 'invariant',
        count: -1,
        samples: [],
        suggestedTool: 'inspect-only',
      };
    }
    results.push(result);
  }
  return results;
}

function assertResults(results: CheckResult[]): void {
  const names = new Set<string>();
  for (const r of results) {
    if (r.count !== -1 && names.has(r.name)) {
      throw new Error(`Duplicate check name: '${r.name}'. Each check name must be unique.`);
    }
    names.add(r.name);
  }
  for (const r of results) {
    if (r.kind === 'sampler' && r.suggestedTool !== 'inspect-only') {
      throw new Error(`Sampler '${r.name}' must have suggestedTool='inspect-only', got '${r.suggestedTool}'.`);
    }
  }
}

// -- Report --

function renderSampleTable(samples: Record<string, unknown>[]): string {
  if (samples.length === 0) return '';
  const rows = samples.slice(0, 5);
  const keys = Object.keys(rows[0]);
  const header = `| ${keys.join(' | ')} |`;
  const sep = `| ${keys.map(() => '---').join(' | ')} |`;
  const body = rows.map(row =>
    `| ${keys.map(k => {
      const v = row[k];
      if (v === null || v === undefined) return '';
      const s = Array.isArray(v) ? JSON.stringify(v) : String(v);
      return s.length > 120 ? s.slice(0, 117) + '...' : s;
    }).join(' | ')} |`
  ).join('\n');
  return `${header}\n${sep}\n${body}`;
}

function renderCheckSection(result: CheckResult): string {
  const lines: string[] = [];
  lines.push(`### ${result.name}`);
  lines.push('');
  lines.push(`> ${result.description}`);
  lines.push('');

  if (result.count === -1) {
    lines.push('**Count**: (errored) | **Suggested cleanup**: inspect-only');
    lines.push('');
    lines.push('(Check raised an exception; see script output for the full stack trace.)');
  } else if (result.kind === 'sampler') {
    lines.push(`**Total rows considered**: ${result.count} | **Suggested cleanup**: inspect-only`);
    if (result.samples.length > 0) {
      lines.push('');
      lines.push(renderSampleTable(result.samples));
    }
  } else if (result.count === 0) {
    lines.push('**Count**: 0 | **Suggested cleanup**: (no rows match this check)');
  } else {
    lines.push(`**Count**: ${result.count} | **Suggested cleanup**: ${result.suggestedTool}`);
    if (result.samples.length > 0) {
      lines.push('');
      lines.push(renderSampleTable(result.samples));
    }
  }
  return lines.join('\n');
}

function renderDiffSection(priorStem: string, entries: DiffEntry[]): string {
  const lines: string[] = [];
  lines.push(`## Diff vs ${priorStem}`);
  lines.push('');
  lines.push('| Check | Prior | Current | Delta |');
  lines.push('|-------|------:|--------:|------:|');
  for (const e of entries) {
    if (e.kind === 'sampler') {
      lines.push(`| ${e.name} | (sampler) | (sampler) | — |`);
    } else if (e.prior === null) {
      lines.push(`| ${e.name} | — | ${String(e.current)} | (new) |`);
    } else if (e.current === null) {
      lines.push(`| ${e.name} | ${String(e.prior)} | — | (removed) |`);
    } else {
      const delta = e.current - e.prior;
      const deltaStr = delta > 0 ? `+${delta}` : String(delta);
      lines.push(`| ${e.name} | ${e.prior} | ${e.current} | ${deltaStr} |`);
    }
  }
  return lines.join('\n');
}

function renderReport(params: {
  stem: string;
  generatedAt: string;
  results: CheckResult[];
  totalTransactions: number;
  sourceFilter: string | null;
  zeroMatchNotice: string | null;
  diffSection: string | null;
}): string {
  const { stem, generatedAt, results, totalTransactions, sourceFilter, zeroMatchNotice, diffSection } = params;
  const lines: string[] = [];

  lines.push(`# Audit Report — ${stem}`);
  lines.push('');
  lines.push(`**Source filter**: ${sourceFilter ?? '(none)'}`);
  lines.push(`**Total transactions scanned**: ${totalTransactions}`);
  // Format: "2026-05-23 14:30:00 UTC"
  lines.push(`**Generated**: ${generatedAt.replace('T', ' ').replace(/\.\d+Z$/, '') + ' UTC'}`);

  if (zeroMatchNotice) {
    lines.push('');
    lines.push(`> ${zeroMatchNotice}`);
  }

  if (diffSection) {
    lines.push('');
    lines.push(diffSection);
  }

  const invariants = results.filter(r => r.kind === 'invariant');
  if (invariants.length > 0) {
    lines.push('');
    lines.push('## Invariant Violations');
    lines.push('');
    for (const r of invariants) {
      lines.push(renderCheckSection(r));
      lines.push('');
    }
  }

  const samplers = results.filter(r => r.kind === 'sampler');
  if (samplers.length > 0) {
    lines.push('## Structural Samplers');
    lines.push('');
    for (const r of samplers) {
      lines.push(renderCheckSection(r));
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd() + '\n';
}

function writeSidecar(params: {
  stem: string;
  generatedAt: string;
  results: CheckResult[];
  totalTransactions: number;
  sourceFilter: string | null;
}): void {
  const { stem, generatedAt, results, totalTransactions, sourceFilter } = params;
  const sidecar: AuditReportSidecar = {
    schemaVersion: 1,
    generatedAt,
    sourceFilter,
    totalTransactionsScanned: totalTransactions,
    checks: {},
  };
  for (const r of results) {
    sidecar.checks[r.name] = {
      count: r.count,
      kind: r.kind,
      suggestedTool: r.suggestedTool,
      description: r.description,
      errored: r.count === -1,
    };
  }
  fs.writeFileSync(path.join(REPORT_DIR, `${stem}.json`), JSON.stringify(sidecar, null, 2) + '\n', 'utf-8');
}

// -- Diff loader --

function loadPriorSidecar(reportsDir: string, currentStem: string): { sidecar: AuditReportSidecar; priorStem: string } | null {
  try {
    const files = fs.readdirSync(reportsDir)
      .filter(f => f.endsWith('.json') && f !== `${currentStem}.json` && !f.startsWith('.'))
      .sort();
    if (files.length === 0) return null;
    const priorFile = files[files.length - 1];
    const priorStem = priorFile.replace(/\.json$/, '');
    const content = fs.readFileSync(path.join(reportsDir, priorFile), 'utf-8');
    const parsed = JSON.parse(content) as AuditReportSidecar;
    if (parsed.schemaVersion !== 1) {
      console.warn(`[audit] Prior sidecar '${priorFile}' has schemaVersion=${String(parsed.schemaVersion)}; expected 1. Skipping diff.`);
      return null;
    }
    return { sidecar: parsed, priorStem };
  } catch {
    return null;
  }
}

function computeDiff(results: CheckResult[], prior: AuditReportSidecar | null, priorStem: string | null): { priorStem: string | null; entries: DiffEntry[] } {
  if (!prior || !priorStem) return { priorStem: null, entries: [] };

  const currentNames = new Set(results.map(r => r.name));
  const entries: DiffEntry[] = [];

  for (const result of results) {
    const priorCheck = prior.checks[result.name];
    entries.push({
      name: result.name,
      kind: result.kind,
      prior: priorCheck !== undefined ? priorCheck.count : null,
      current: result.count,
    });
  }

  for (const [name, priorCheck] of Object.entries(prior.checks)) {
    if (!currentNames.has(name)) {
      entries.push({ name, kind: priorCheck.kind, prior: priorCheck.count, current: null });
    }
  }

  return { priorStem, entries };
}

// -- Main --

function parseArgs(argv: string[]): { sourceFilter: string | null } {
  const args = argv.slice(2);
  let sourceFilter: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sourceFilter = args[++i];
    }
  }
  return { sourceFilter };
}

function makeAuditTimestamp(): { stem: string; generatedAt: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stem =
    `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}-${pad(now.getUTCMinutes())}-${pad(now.getUTCSeconds())}Z`;
  return { stem, generatedAt: now.toISOString() };
}

async function main(): Promise<void> {
  const { sourceFilter } = parseArgs(process.argv);

  if (sourceFilter && !KNOWN_SOURCES.has(sourceFilter)) {
    console.warn(`[audit] WARNING: unknown source value '${sourceFilter}' — query will likely return 0 rows`);
  }

  const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!, { auth: { persistSession: false } });

  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const { stem, generatedAt } = makeAuditTimestamp();

  console.log('[audit] connecting to Supabase...');

  // Get total transaction count for report header (also validates the connection).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let countQ: any = supabase.from('transactions').select('id', { count: 'exact', head: true });
  if (sourceFilter) countQ = countQ.eq('source', sourceFilter);
  const { count: totalRaw, error: countErr } = await countQ;
  if (countErr) {
    console.error('[audit] Failed to connect to database:', (countErr as { message: string }).message);
    process.exit(1);
  }
  const totalTransactions = (totalRaw as number | null) ?? 0;

  const zeroMatchNotice = sourceFilter && totalTransactions === 0
    ? `Filtered to source=${sourceFilter}: 0 transactions matched`
    : null;

  const ctx: CheckContext = { supabase, sourceFilter };
  const results = await runChecks(ctx);

  assertResults(results);

  const prior = loadPriorSidecar(REPORT_DIR, stem);
  const { priorStem, entries: diffEntries } = computeDiff(results, prior?.sidecar ?? null, prior?.priorStem ?? null);
  const diffSection = priorStem && diffEntries.length > 0
    ? renderDiffSection(priorStem, diffEntries)
    : null;

  const report = renderReport({ stem, generatedAt, results, totalTransactions, sourceFilter, zeroMatchNotice, diffSection });
  const reportPath = path.join(REPORT_DIR, `${stem}.md`);
  fs.writeFileSync(reportPath, report, 'utf-8');

  writeSidecar({ stem, generatedAt, results, totalTransactions, sourceFilter });

  console.log(`[audit] wrote ${reportPath}`);
  console.log(`[audit] wrote ${path.join(REPORT_DIR, `${stem}.json`)}`);
  console.log('[audit] done');
}

main().catch(err => {
  console.error('[audit] Fatal error:', err);
  process.exit(1);
});
