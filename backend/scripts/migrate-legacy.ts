#!/usr/bin/env tsx
/**
 * One-time migration script: imports NaggingMoney CSV history into the expense tracker DB.
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/migrate-legacy.ts [--dry-run] [--batch-size <n>] <csv-path>
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env
 */

import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readCSVFile, readRawRows, type ParsedLegacyRow, type ParseStats, type RawLegacyRow } from '../src/services/legacy-csv-parser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = ReturnType<typeof createClient<any>>;

dotenv.config();

// -- Env validation --

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[migrate-legacy] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

// -- Arg parsing --

function parseArgs(argv: string[]): { csvPath: string; dryRun: boolean; batchSize: number } {
  const args = argv.slice(2);
  let dryRun = false;
  let batchSize = 100;
  let csvPath = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      const n = parseInt(args[++i], 10);
      if (isNaN(n) || n < 1) {
        console.error('[migrate-legacy] --batch-size must be a positive integer');
        process.exit(1);
      }
      batchSize = n;
    } else if (!args[i].startsWith('--')) {
      csvPath = args[i];
    }
  }

  if (!csvPath) {
    console.error('Usage: npx tsx scripts/migrate-legacy.ts [--dry-run] [--batch-size <n>] <csv-path>');
    process.exit(1);
  }

  const resolved = path.resolve(process.cwd(), csvPath);
  if (!fs.existsSync(resolved)) {
    console.error(`[migrate-legacy] File not found: ${resolved}`);
    process.exit(1);
  }

  return { csvPath: resolved, dryRun, batchSize };
}

// -- Dedup set loader (T010) --

async function loadDedupSet(supabase: DB): Promise<Set<string>> {
  console.log('[migrate-legacy] Loading dedup index...');
  const { data, error } = await supabase
    .from('transactions')
    .select('amount, transaction_at, note')
    .eq('source', 'legacy_migration');

  if (error) throw new Error(`Failed to load dedup index: ${error.message}`);

  const set = new Set<string>();
  for (const row of (data ?? []) as { amount: number; transaction_at: string; note: string | null }[]) {
    set.add(`${row.amount}|${row.transaction_at}|${row.note ?? ''}`);
  }
  console.log(`[migrate-legacy] Dedup index loaded: ${set.size} existing legacy records`);
  return set;
}

// -- Batch insert (T012, T013) --

interface RunCounters {
  imported: number;
  deduplicated: number;
  failed: number;
}

async function insertBatch(
  supabase: DB,
  batch: ParsedLegacyRow[],
  dedupSet: Set<string>,
  counters: RunCounters
): Promise<void> {
  // Filter by dedup before DB write
  const toInsert = batch.filter((row) => {
    if (dedupSet.has(row._dedup_key)) {
      counters.deduplicated++;
      return false;
    }
    return true;
  });

  if (toInsert.length === 0) return;

  // Strip internal-only and items fields before transaction insert
  const dbRows = toInsert.map(({ _dedup_key: _d, _raw_line: _r, items: _i, ...rest }) => rest);

  const { data: insertedTxs, error } = await supabase
    .from('transactions')
    .insert(dbRows as never[])
    .select('id');

  if (error) {
    // Batch-level failure — fall back to row-by-row to maximise commits (T013)
    for (let i = 0; i < toInsert.length; i++) {
      const { _dedup_key, _raw_line, items, ...rowData } = toInsert[i];
      const { data: txData, error: rowErr } = await supabase
        .from('transactions')
        .insert(rowData as unknown as never[])
        .select('id')
        .single();
      if (rowErr) {
        counters.failed++;
        console.warn(`[migrate-legacy] Row ${_raw_line} failed: ${rowErr.message}`);
      } else {
        const itemRows = items.map((item, idx) => ({
          transaction_id: (txData as { id: string }).id,
          name: item.name,
          amount: item.amount,
          tags: item.tags,
          sort_order: idx,
        }));
        if (itemRows.length > 0) {
          await supabase.from('transaction_items').insert(itemRows);
        }
        dedupSet.add(_dedup_key);
        counters.imported++;
      }
    }
    return;
  }

  // Bulk-insert items for the successfully inserted transactions
  const itemRows = (insertedTxs ?? []).flatMap((tx: { id: string }, i: number) =>
    toInsert[i].items.map((item, idx) => ({
      transaction_id: tx.id,
      name: item.name,
      amount: item.amount,
      tags: item.tags,
      sort_order: idx,
    }))
  );
  if (itemRows.length > 0) {
    const { error: itemErr } = await supabase.from('transaction_items').insert(itemRows);
    if (itemErr) {
      console.warn(`[migrate-legacy] transaction_items insert failed for batch: ${itemErr.message}`);
    }
  }

  for (const row of toInsert) {
    dedupSet.add(row._dedup_key);
    counters.imported++;
  }
}

// -- Terminal summary (T014) --

function printSummary(stats: ParseStats, counters: RunCounters): void {
  const total99 = stats.skipped99;
  console.log('\n=== Import Complete ===');
  console.log(`Total rows read:        ${stats.total + total99}`);
  console.log(`  Skipped (type-99):    ${total99}`);
  console.log(`  Imported (expense):   ${counters.imported - stats.income}`);
  console.log(`  Imported (income→refund): ${stats.income}`);
  console.log(`  Deduplicated:         ${counters.deduplicated}`);
  console.log(`  Parse failures:       ${stats.parseFailures}`);
  console.log(`  Non-TWD flagged:      ${stats.nonTWD}`);
  if (stats.unmappedCategories.length > 0) {
    console.log(`  Unmapped categories:  ${stats.unmappedCategories.join(', ')}`);
  }
  if (stats.unmappedAccounts.length > 0) {
    console.log(`  Unmapped accounts:    ${stats.unmappedAccounts.join(', ')}`);
  }
}

// -- Dry-run file writer (T023, T024, T025) --

function makeTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `${String(now.getMilliseconds()).padStart(3, '0')}`
  );
}

function writeDryRunFile(
  rows: ParsedLegacyRow[],
  stats: ParseStats,
  csvPath: string,
  existingCount: number,
  timestamp: string
): string {
  const now = new Date();
  const outFile = `dry-run-${timestamp}.txt`;

  // Category coverage
  const catCount = new Map<string, number>();
  for (const row of rows) {
    const catTag = row.tags.find((t) => t.includes(':'));
    if (catTag) {
      const cat = catTag.split(':')[0];
      catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
    }
  }

  const lines: string[] = [];
  lines.push(`=== Dry Run Report: ${now.toISOString()} ===`);
  lines.push(`Source file: ${csvPath}`);
  lines.push('');
  lines.push(`Total rows read:          ${stats.total + stats.skipped99}`);
  lines.push(`  Skipped (type-99):      ${stats.skipped99}`);
  lines.push(`  Expense rows:           ${stats.expenses}`);
  lines.push(`  Income rows:            ${stats.income}`);
  lines.push(`  Parse failures:         ${stats.parseFailures}`);
  lines.push(`  Non-TWD rows:           ${stats.nonTWD}`);
  lines.push('');
  lines.push('Category coverage:');
  for (const [cat, count] of [...catCount.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${cat.padEnd(6)} ${count}`);
  }
  if (stats.unmappedCategories.length > 0) {
    lines.push(`  (unmapped): ${stats.unmappedCategories.join(', ')}`);
  } else {
    lines.push('  (unmapped): none');
  }
  lines.push('');
  if (stats.unmappedAccounts.length > 0) {
    lines.push(`Unmapped account values: ${stats.unmappedAccounts.join(', ')}`);
  } else {
    lines.push('Unmapped account values: none');
  }
  lines.push('');
  lines.push('Sample output (first 10 rows):');
  lines.push('  Line | Date                    | Type    | Amount | Tags                  | Note');
  lines.push('  -----|-------------------------|---------|--------|-----------------------|--------------------------');
  for (const row of rows.slice(0, 10)) {
    const date = row.transaction_at.slice(0, 19).replace('T', ' ');
    const type = row.transaction_type.padEnd(7);
    const amount = String(row.amount).padStart(6);
    const tags = row.tags.join(', ').slice(0, 21).padEnd(21);
    const note = row.note.slice(0, 26);
    lines.push(`  ${String(row._raw_line).padStart(4)} | ${date} | ${type} | ${amount} | ${tags} | ${note}`);
  }
  lines.push('');
  lines.push(`Would insert: ${rows.length} records`);
  lines.push(`Already imported (dedup): ${existingCount}`);

  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf-8');
  return outFile;
}

// -- 備註 analysis --

type BeizhuPattern = 'A_tag' | 'B_route' | 'C_paren' | 'D_medical' | 'E_mixed' | 'F_narrative';
type Confidence = 'HIGH' | 'MEDIUM' | 'AMBIGUOUS';

interface BeizhuDetection {
  pattern: BeizhuPattern;
  confidence: Confidence;
  proposedTag?: string;
  proposedNote?: string;
  proposedItem?: string;
}

interface BeizhuEntry {
  value: string;
  count: number;
  contexts: Array<{ category: string; item: string }>;  // up to 5 unique examples
  detection: BeizhuDetection;
}

const MEDICAL_SUFFIXES = ['醫院', '診所', '骨科', '中醫', '牙科', '眼科', '診療所', '物理治療', '復健'];

function detectBeizhu(row: RawLegacyRow): BeizhuDetection {
  const v = row.beizhu;

  // F: too long / complex to classify — pure note
  if (v.length > 25) {
    return { pattern: 'F_narrative', confidence: 'HIGH', proposedNote: v };
  }

  // B: arrow route (→ is unambiguous)
  if (v.includes('→')) {
    return { pattern: 'B_route', confidence: 'HIGH', proposedNote: v };
  }

  // B: dash route — only when category=行 and item starts with 搭 (context-dependent)
  if (row.category === '行' && (row.item.startsWith('搭') || row.item.startsWith('坐')) && v.includes(' - ')) {
    return { pattern: 'B_route', confidence: 'HIGH', proposedNote: v };
  }

  // C: parenthesis split — text(note) pattern
  const parenIdx = v.indexOf('(');
  if (parenIdx > 0) {
    const proposedItem = v.slice(0, parenIdx).trim();
    const proposedNote = v.slice(parenIdx + 1).replace(/\)$/, '').trim();
    return { pattern: 'C_paren', confidence: 'MEDIUM', proposedItem, proposedNote };
  }

  // D: medical institution + body part / department
  const firstSpaceIdx = v.indexOf(' ');
  if (firstSpaceIdx > 0) {
    const firstToken = v.slice(0, firstSpaceIdx);
    const rest = v.slice(firstSpaceIdx + 1).trim();
    if (MEDICAL_SUFFIXES.some((s) => firstToken.endsWith(s))) {
      return { pattern: 'D_medical', confidence: 'MEDIUM', proposedTag: firstToken, proposedNote: rest };
    }
  }

  // E: contains separators but no clear rule
  if (v.includes(' ') || v.includes('+') || v.includes('/') || v.includes('-')) {
    return { pattern: 'E_mixed', confidence: 'AMBIGUOUS' };
  }

  // A: single token — plain tag
  return { pattern: 'A_tag', confidence: 'HIGH', proposedTag: v };
}

function buildBeizhuReport(rawRows: RawLegacyRow[]): Map<string, BeizhuEntry> {
  const map = new Map<string, BeizhuEntry>();

  for (const row of rawRows) {
    const existing = map.get(row.beizhu);
    const ctx = { category: row.category, item: row.item };

    if (existing) {
      existing.count++;
      // Keep up to 5 unique contexts
      const already = existing.contexts.some((c) => c.category === ctx.category && c.item === ctx.item);
      if (!already && existing.contexts.length < 5) existing.contexts.push(ctx);
    } else {
      map.set(row.beizhu, {
        value: row.beizhu,
        count: 1,
        contexts: [ctx],
        detection: detectBeizhu(row),
      });
    }
  }

  return map;
}

const PATTERN_LABELS: Record<BeizhuPattern, string> = {
  A_tag:       'A_tag       (single tag, HIGH)',
  B_route:     'B_route     (transit/route note, HIGH)',
  C_paren:     'C_paren     (parenthesis split, MEDIUM)',
  D_medical:   'D_medical   (institution + symptom, MEDIUM)',
  E_mixed:     'E_mixed     (multi-word, AMBIGUOUS ⚠)',
  F_narrative: 'F_narrative (long narrative note, HIGH)',
};

const PATTERN_ORDER: BeizhuPattern[] = ['A_tag', 'B_route', 'C_paren', 'D_medical', 'E_mixed', 'F_narrative'];

function writeBeizhuAnalysis(rawRows: RawLegacyRow[], csvPath: string, timestamp: string): string {
  const entries = buildBeizhuReport(rawRows);
  const outFile = `beiZhu-analysis-${timestamp}.txt`;

  // Group by pattern
  const groups = new Map<BeizhuPattern, BeizhuEntry[]>();
  for (const p of PATTERN_ORDER) groups.set(p, []);
  for (const entry of entries.values()) {
    groups.get(entry.detection.pattern)!.push(entry);
  }
  // Sort each group by count descending
  for (const group of groups.values()) {
    group.sort((a, b) => b.count - a.count);
  }

  const lines: string[] = [];
  const totalRows = rawRows.length;
  const totalUnique = entries.size;

  lines.push(`=== 備註 Analysis Report: ${timestamp.replace(/-/g, ' ').replace('T', ' ')} ===`);
  lines.push(`Source: ${csvPath}`);
  lines.push('');
  lines.push(`Total rows with non-empty 備註: ${totalRows}`);
  lines.push(`Unique 備註 values:              ${totalUnique}`);
  lines.push('');
  lines.push('Pattern distribution:');
  for (const p of PATTERN_ORDER) {
    const group = groups.get(p)!;
    const rowCount = group.reduce((s, e) => s + e.count, 0);
    const uniqCount = group.length;
    lines.push(`  ${PATTERN_LABELS[p]}`);
    lines.push(`    ${String(rowCount).padStart(5)} rows | ${String(uniqCount).padStart(4)} unique values`);
  }

  for (const p of PATTERN_ORDER) {
    const group = groups.get(p)!;
    if (group.length === 0) continue;

    lines.push('');
    lines.push('─'.repeat(70));

    switch (p) {
      case 'A_tag':
        lines.push('GROUP A — Single Tag (HIGH confidence)');
        lines.push('Current behaviour: stored as plain tag. No change needed.');
        lines.push('');
        lines.push('  Value                | Ct  | Sample contexts (category:item)');
        lines.push('  ---------------------|-----|-------------------------------------------');
        for (const e of group) {
          const ctxStr = e.contexts.map((c) => `${c.category||'–'}:${c.item||'–'}`).join(' | ');
          lines.push(`  ${e.value.padEnd(21)}| ${String(e.count).padStart(3)} | ${ctxStr}`);
        }
        break;

      case 'B_route':
        lines.push('GROUP B — Route / Transit Note (HIGH confidence)');
        lines.push('Proposed behaviour: store as note (not tag). Keeps timeline readable.');
        lines.push('');
        lines.push('  Value                          | Ct  | Context');
        lines.push('  -------------------------------|-----|---------------------------');
        for (const e of group) {
          const ctxStr = e.contexts.map((c) => `${c.category||'–'}:${c.item||'–'}`).join(' | ');
          lines.push(`  ${e.value.padEnd(31)}| ${String(e.count).padStart(3)} | ${ctxStr}`);
        }
        break;

      case 'C_paren':
        lines.push('GROUP C — Parenthesis Split (MEDIUM confidence)');
        lines.push('Proposed: text before ( → item supplement. Text inside () → note.');
        lines.push('');
        lines.push('  Value                          | Ct | Context           | Proposed split');
        lines.push('  -------------------------------|----|--------------------|----------------------------------');
        for (const e of group) {
          const ctxStr = e.contexts[0] ? `${e.contexts[0].category||'–'}:${e.contexts[0].item||'–'}` : '—';
          const split = e.detection.proposedItem
            ? `item="${e.detection.proposedItem}" note="${e.detection.proposedNote ?? ''}"`
            : '(no split detected)';
          lines.push(`  ${e.value.padEnd(31)}| ${String(e.count).padStart(2)} | ${ctxStr.padEnd(18)} | ${split}`);
        }
        break;

      case 'D_medical':
        lines.push('GROUP D — Medical Institution + Symptom/Dept (MEDIUM confidence)');
        lines.push('Proposed: institution name → tag. Remainder → note.');
        lines.push('');
        lines.push('  Value                | Ct | Context     | tag            | note');
        lines.push('  ----------------------|----|-------------|----------------|------------------');
        for (const e of group) {
          const ctxStr = e.contexts[0] ? `${e.contexts[0].category||'–'}:${e.contexts[0].item||'–'}` : '—';
          lines.push(
            `  ${e.value.padEnd(22)}| ${String(e.count).padStart(2)} | ${ctxStr.padEnd(11)} | ${(e.detection.proposedTag ?? '').padEnd(14)} | ${e.detection.proposedNote ?? ''}`
          );
        }
        break;

      case 'E_mixed':
        lines.push('GROUP E — AMBIGUOUS ⚠ NEEDS YOUR REVIEW');
        lines.push('Cannot determine intent. Please review each value and indicate the rule.');
        lines.push('');
        lines.push('Feedback format (one line per row):');
        lines.push('  VALUE → tag=X  OR  VALUE → note=X  OR  VALUE → tag=X note=Y  OR  VALUE → keep-as-is');
        lines.push('');
        lines.push('  Value                          | Ct  | Sample contexts');
        lines.push('  -------------------------------|-----|-------------------------------------------');
        for (const e of group) {
          const ctxStr = e.contexts.map((c) => `${c.category||'–'}:${c.item||'–'}`).join(' | ');
          lines.push(`  ${e.value.padEnd(31)}| ${String(e.count).padStart(3)} | ${ctxStr}`);
        }
        break;

      case 'F_narrative':
        lines.push('GROUP F — Narrative Note (HIGH confidence)');
        lines.push('Too complex to parse. Stored as note verbatim.');
        lines.push('');
        lines.push('  Value                                           | Ct | Context');
        lines.push('  ------------------------------------------------|----|-----------------------------');
        for (const e of group) {
          const ctxStr = e.contexts[0] ? `${e.contexts[0].category||'–'}:${e.contexts[0].item||'–'}` : '—';
          const preview = e.value.length > 48 ? e.value.slice(0, 45) + '...' : e.value;
          lines.push(`  ${preview.padEnd(48)}| ${String(e.count).padStart(2)} | ${ctxStr}`);
        }
        break;
    }
  }

  lines.push('');
  lines.push('─'.repeat(70));
  lines.push('Next step: Review GROUP E above. For each value, provide a feedback line.');
  lines.push('The rules will then be encoded and the dry-run re-run to verify.');

  fs.writeFileSync(outFile, lines.join('\n') + '\n', 'utf-8');
  return outFile;
}

// -- Main --

async function main() {
  const { csvPath, dryRun, batchSize } = parseArgs(process.argv);

  const label = dryRun ? 'Dry run' : 'Starting import';
  console.log(`[migrate-legacy] ${label}: ${path.basename(csvPath)}`);

  // Parse CSV
  const { rows, stats } = readCSVFile(csvPath);

  if (dryRun) {
    // In dry-run mode we don't touch the DB at all (T022)
    const timestamp = makeTimestamp();
    const outFile = writeDryRunFile(rows, stats, csvPath, 0, timestamp);
    console.log(`[migrate-legacy] Dry run complete — see ${outFile}`);
    const rawRows = readRawRows(csvPath);
    const analysisFile = writeBeizhuAnalysis(rawRows, csvPath, timestamp);
    console.log(`[migrate-legacy] 備註 analysis   — see ${analysisFile}`);
    return;
  }

  const supabase: DB = createClient<never>(SUPABASE_URL!, SUPABASE_KEY!, {
    auth: { persistSession: false },
  });

  const dedupSet = await loadDedupSet(supabase);
  const existingCount = dedupSet.size;
  const counters: RunCounters = { imported: 0, deduplicated: 0, failed: 0 };

  const totalBatches = Math.ceil(rows.length / batchSize);
  for (let b = 0; b < totalBatches; b++) {
    const batch = rows.slice(b * batchSize, (b + 1) * batchSize);
    process.stdout.write(`\r[migrate-legacy] Batch ${b + 1}/${totalBatches}...`);
    await insertBatch(supabase, batch, dedupSet, counters);
  }
  process.stdout.write('\n');

  // Adjust imported count: counters.imported counts all successful inserts including income rows
  printSummary(stats, counters);
  void existingCount;
}

main().catch((err) => {
  console.error('[migrate-legacy] Fatal error:', err);
  process.exit(1);
});
