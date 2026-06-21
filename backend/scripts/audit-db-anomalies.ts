#!/usr/bin/env tsx
/**
 * Audit: catalogue current-DB data anomalies with counts, and write a markdown report.
 *
 * Surfaces the kinds of gaps that recur after the legacy migration so the manual-cleanup
 * scope is quantifiable:
 *   A 未分類            expense with no 主:子 category tag
 *   B 無品項名稱        expense with no items, or all item names blank
 *   C 無分類且無名稱     A ∧ B (the worst — neither what nor which category)
 *   D 無法對帳          SUM(items) − discount − refund + fee ≠ paid (likely a lost discount/fee)
 *   E 孤兒 fee/refund   fee/refund transaction with no parent_transaction_id (nets against nothing)
 *   F 殘留遷移調整       transaction_adjustments kind ∈ {fee,refund} with source=legacy_migration
 *                       (leftover from migration 016 step C3)
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/audit-db-anomalies.ts
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in backend/.env. Read-only (SELECTs only).
 * Report written to specs/015-legacy-audit-catalog/audit-reports/db-anomalies-<ts>.md (git-ignored).
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}
const s = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Tx {
  id: string; amount: number; transaction_at: string; transaction_type: string;
  payment_method: string; source: string | null; tags: string[]; note: string | null;
  parent_transaction_id: string | null;
  transaction_items: { name: string | null; amount: number | null }[];
  transaction_adjustments: { kind: string; amount: number }[];
}

async function fetchAll(): Promise<Tx[]> {
  const out: Tx[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await s
      .from('transactions')
      .select('id, amount, transaction_at, transaction_type, payment_method, source, tags, note, parent_transaction_id, transaction_items(name, amount), transaction_adjustments(kind, amount)')
      .range(from, from + page - 1);
    if (error) throw new Error(`fetch: ${error.message}`);
    out.push(...((data ?? []) as unknown as Tx[]));
    if ((data ?? []).length < page) break;
  }
  return out;
}

const hasCategory = (t: Tx) => t.tags.some((x) => x.includes(':'));
const hasName = (t: Tx) => t.transaction_items.length > 0 && t.transaction_items.some((i) => i.name && i.name.trim());

function bySource(rows: Tx[]): string {
  const m: Record<string, number> = {};
  for (const r of rows) m[r.source ?? 'pwa/null'] = (m[r.source ?? 'pwa/null'] ?? 0) + 1;
  return Object.entries(m).map(([k, v]) => `${k}=${v}`).join(', ') || '—';
}
const sum = (rows: Tx[]) => rows.reduce((x, r) => x + r.amount, 0);

async function main() {
  const all = await fetchAll();
  const expenses = all.filter((t) => t.transaction_type === 'expense');

  const A = expenses.filter((t) => !hasCategory(t));
  const B = expenses.filter((t) => !hasName(t));
  const C = expenses.filter((t) => !hasCategory(t) && !hasName(t));

  const D = expenses.filter((t) => {
    const items = t.transaction_items;
    if (items.length === 0 || items.some((i) => i.amount == null)) return false;
    const sticker = items.reduce((x, i) => x + (i.amount as number), 0);
    let disc = 0, fee = 0, ref = 0;
    for (const a of t.transaction_adjustments) {
      if (a.kind === 'discount') disc += a.amount; else if (a.kind === 'fee') fee += a.amount; else if (a.kind === 'refund') ref += a.amount;
    }
    return sticker - disc - ref + fee - t.amount !== 0;
  });

  const E = all.filter((t) => (t.transaction_type === 'fee' || t.transaction_type === 'refund') && !t.parent_transaction_id);

  const { data: adjRows } = await s.from('transaction_adjustments').select('kind, source').in('kind', ['fee', 'refund']).eq('source', 'legacy_migration');
  const F = (adjRows ?? []).length;
  const Fbyk: Record<string, number> = {};
  for (const a of adjRows ?? []) Fbyk[a.kind] = (Fbyk[a.kind] ?? 0) + 1;

  const lines: string[] = [];
  lines.push(`# DB anomaly audit — ${new Date().toISOString().slice(0, 19)}Z`);
  lines.push('');
  lines.push(`Scanned **${all.length}** transactions (**${expenses.length}** expenses). Counts of current-DB anomalies:`);
  lines.push('');
  lines.push('| # | anomaly | count | by source | amount |');
  lines.push('|---|---|--:|---|--:|');
  lines.push(`| A | 未分類 (no category) | ${A.length} | ${bySource(A)} | ${sum(A)} |`);
  lines.push(`| B | 無品項名稱 (no item name) | ${B.length} | ${bySource(B)} | ${sum(B)} |`);
  lines.push(`| C | 無分類且無名稱 (A∧B) | ${C.length} | ${bySource(C)} | ${sum(C)} |`);
  lines.push(`| D | 無法對帳 (items+adj ≠ paid) | ${D.length} | ${bySource(D)} | — |`);
  lines.push(`| E | 孤兒 fee/refund (no parent) | ${E.length} | ${bySource(E)} | — |`);
  lines.push(`| F | 殘留遷移 fee/refund 調整 | ${F} | ${Object.entries(Fbyk).map(([k, v]) => `${k}=${v}`).join(', ') || '—'} | — |`);
  lines.push('');
  lines.push('Notes: totals are unaffected by D (classify() allocates the full paid amount); C is the subset that needs both a name and a category. A blind spot for D: legacy expenses imported as a single net-amount item carry no detectable sticker/paid gap.');
  lines.push('');
  lines.push('### C — list (no category AND no name)');
  for (const t of C.sort((a, b) => a.transaction_at.localeCompare(b.transaction_at)))
    lines.push(`- ${t.transaction_at.slice(0, 10)} ${t.amount} ${t.payment_method} src=${t.source ?? 'pwa/null'} id=${t.id.slice(0, 8)}`);
  lines.push('');
  lines.push('### E — orphan fee/refund (no parent)');
  for (const t of E.sort((a, b) => a.transaction_at.localeCompare(b.transaction_at)))
    lines.push(`- ${t.transaction_at.slice(0, 10)} ${t.transaction_type} ${t.amount} src=${t.source ?? 'pwa/null'} note="${t.note ?? ''}" id=${t.id.slice(0, 8)}`);

  const report = lines.join('\n') + '\n';
  const dir = path.resolve(process.cwd(), '../specs/015-legacy-audit-catalog/audit-reports');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `db-anomalies-${new Date().toISOString().slice(0, 10)}.md`);
  fs.writeFileSync(file, report);

  console.log(report);
  console.log(`\nReport written to ${path.relative(path.resolve(process.cwd(), '..'), file)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
