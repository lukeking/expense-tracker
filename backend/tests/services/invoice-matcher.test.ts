import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedInvoice } from '../../src/types';
import { runImportPipeline, computeConfidence, applyInvoiceItems } from '../../src/services/invoice-matcher';

// ─── Minimal in-memory fake Supabase ──────────────────────────────────────────
// Supports the chainable subset the pipeline/queries use (select/insert/update +
// eq/is/in/gte/lte/order/limit/single). Filters are applied against seeded tables
// so the REAL pipeline runs end-to-end. `calls.insertTransactions` lets tests
// assert the SC-003 invariant: the import never creates a transaction.

type Row = Record<string, unknown>;

function makeFakeSupabase(seed: { transactions?: Row[]; invoices?: Row[]; transaction_items?: Row[] }) {
  const tables: Record<string, Row[]> = {
    transactions: seed.transactions ?? [],
    invoices: seed.invoices ?? [],
    transaction_items: seed.transaction_items ?? [],
  };
  const calls = { insertTransactions: 0 };
  let idCounter = 1;

  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let insertRows: Row[] = [];
    let updatePatch: Row = {};
    let wantSingle = false;

    function execute() {
      if (mode === 'insert') {
        const created = insertRows.map((r) => ({ id: `gen-${idCounter++}`, ...r }));
        tables[table].push(...created);
        if (table === 'transactions') calls.insertTransactions += created.length;
        return wantSingle ? { data: created[0], error: null } : { data: created, error: null };
      }
      if (mode === 'update') {
        const matched = tables[table].filter((r) => filters.every((f) => f(r)));
        for (const r of matched) Object.assign(r, updatePatch);
        return { data: matched, error: null };
      }
      if (mode === 'delete') {
        tables[table] = tables[table].filter((r) => !filters.every((f) => f(r)));
        return { data: null, error: null };
      }
      const rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (wantSingle) return { data: rows[0] ?? null, error: rows[0] ? null : { message: 'not found' } };
      return { data: rows, error: null };
    }

    const builder: Record<string, unknown> = {
      select() { return builder; },
      insert(rows: Row | Row[]) {
        mode = 'insert';
        insertRows = Array.isArray(rows) ? rows : [rows];
        return builder;
      },
      update(patch: Row) { mode = 'update'; updatePatch = patch; return builder; },
      delete() { mode = 'delete'; return builder; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
      is(col: string, val: unknown) { filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return builder; },
      in(col: string, arr: unknown[]) { filters.push((r) => arr.includes(r[col])); return builder; },
      gte(col: string, val: unknown) { filters.push((r) => String(r[col]) >= String(val)); return builder; },
      lte(col: string, val: unknown) { filters.push((r) => String(r[col]) <= String(val)); return builder; },
      order() { return builder; },
      limit() { return builder; },
      single() { wantSingle = true; return builder; },
      then(resolve: (v: unknown) => void) { resolve(execute()); },
    };
    return builder;
  }

  return { client: { from } as unknown as SupabaseClient, tables, calls };
}

function makeInvoice(overrides: Partial<ParsedInvoice> = {}): ParsedInvoice {
  return {
    invoice_number: 'AB-00000001',
    seller_name: '全家便利商店',
    seller_tax_id: '12345678',
    invoice_date: new Date('2025-04-18T00:00:00Z'),
    gross_amount: 180,
    allowance: 0,
    net_amount: 180,
    invoice_status: 'active',
    items: [],
    ...overrides,
  };
}

function makeTxRow(over: Partial<Row> = {}): Row {
  return {
    id: 'tx-001',
    transaction_type: 'expense',
    amount: 180,
    matched_invoice_id: null,
    note: null,
    transaction_at: '2025-04-18T10:00:00.000Z',
    created_at: '2025-04-18T10:00:00.000Z',
    ...over,
  };
}

const NO_SKIP = { voidedCount: 0, zeroCount: 0, parseFailedCount: 0 };

// ─── computeConfidence (FR-004) ───────────────────────────────────────────────

describe('computeConfidence', () => {
  it('exact = same calendar day AND exact amount', () => {
    expect(computeConfidence('2025-04-18T00:00:00Z', '2025-04-18T09:00:00Z', 180, 180)).toBe('exact');
  });
  it('near when different day even if amount matches', () => {
    expect(computeConfidence('2025-04-18T00:00:00Z', '2025-04-20T09:00:00Z', 180, 180)).toBe('near');
  });
  it('near when same day but amount differs (forex)', () => {
    expect(computeConfidence('2025-04-18T00:00:00Z', '2025-04-18T09:00:00Z', 175, 180)).toBe('near');
  });
});

// ─── runImportPipeline (enrichment-only) ──────────────────────────────────────

describe('runImportPipeline — dedup (FR-001)', () => {
  it('skips invoices already present and does not reprocess them', async () => {
    const { client, calls } = makeFakeSupabase({
      invoices: [{ invoice_number: 'AB-00000001' }],
      transactions: [makeTxRow()],
    });
    const counters = await runImportPipeline(client, [makeInvoice()], 'run-1', NO_SKIP);
    expect(counters.skippedDuplicate).toBe(1);
    expect(counters.matchedExact + counters.matchedNear).toBe(0);
    expect(calls.insertTransactions).toBe(0);
  });
});

describe('runImportPipeline — auto-link (FR-003/FR-004)', () => {
  it('1 same-day exact candidate → matched_exact, enriched, items filled', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-180', amount: 180, transaction_at: '2025-04-18T08:00:00.000Z' })],
    });
    const invoice = makeInvoice({ items: [{ name: '咖啡', quantity: 1, unit_price: 180, amount: 180 }] });
    const counters = await runImportPipeline(fake.client, [invoice], 'run-1', NO_SKIP);

    expect(counters.matchedExact).toBe(1);
    expect(counters.matched[0]).toMatchObject({ confidence: 'exact', items_outcome: 'filled', invoice_number: 'AB-00000001' });
    const tx = fake.tables.transactions[0];
    expect(tx.matched_invoice_id).not.toBeNull();
    expect(tx.invoice_number).toBe('AB-00000001');
    expect(fake.tables.invoices[0]).toMatchObject({ match_status: 'matched', match_confidence: 'exact' });
    expect(fake.tables.transaction_items.some((i) => i.name === '咖啡')).toBe(true);
    expect(fake.calls.insertTransactions).toBe(0); // SC-003
  });

  it('1 exact candidate 2 days off → matched_near', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-180', amount: 180, transaction_at: '2025-04-16T08:00:00.000Z' })],
    });
    const counters = await runImportPipeline(fake.client, [makeInvoice()], 'run-1', NO_SKIP);
    expect(counters.matchedNear).toBe(1);
    expect(counters.matched[0].confidence).toBe('near');
  });

  it('does not overwrite items when the transaction already has items (FR-009 → kept)', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-180', amount: 180 })],
      transaction_items: [{ id: 'it-1', transaction_id: 'tx-180', name: '舊項目', amount: 180 }],
    });
    const invoice = makeInvoice({ items: [{ name: '發票項目', quantity: 1, unit_price: 180, amount: 180 }] });
    const counters = await runImportPipeline(fake.client, [invoice], 'run-1', NO_SKIP);
    expect(counters.matched[0].items_outcome).toBe('kept');
    expect(fake.tables.transaction_items.map((i) => i.name)).toEqual(['舊項目']);
  });
});

describe('runImportPipeline — ambiguous (FR-006/FR-013)', () => {
  it('≥2 exact candidates → ambiguous, no transaction enriched', async () => {
    const fake = makeFakeSupabase({
      transactions: [
        makeTxRow({ id: 'tx-a', amount: 180 }),
        makeTxRow({ id: 'tx-b', amount: 180 }),
      ],
    });
    const counters = await runImportPipeline(fake.client, [makeInvoice()], 'run-1', NO_SKIP);
    expect(counters.ambiguous).toBe(1);
    expect(fake.tables.invoices[0].match_status).toBe('ambiguous');
    expect(fake.tables.transactions.every((t) => t.matched_invoice_id === null)).toBe(true);
  });

  it('0 exact but a forex candidate within ±7 days → ambiguous (never auto-linked)', async () => {
    const fake = makeFakeSupabase({
      // amount 175 ≈ 180 within ±5%; 5 days off → inside ±7-day forex window, outside ±2-day exact
      transactions: [makeTxRow({ id: 'tx-fx', amount: 175, transaction_at: '2025-04-23T08:00:00.000Z' })],
    });
    const counters = await runImportPipeline(fake.client, [makeInvoice()], 'run-1', NO_SKIP);
    expect(counters.ambiguous).toBe(1);
    expect(counters.matchedExact + counters.matchedNear).toBe(0);
    expect(fake.tables.invoices[0].match_status).toBe('ambiguous');
  });
});

describe('runImportPipeline — skipped_unmatched (FR-007)', () => {
  it('0 exact and 0 forex → skipped_unmatched, NO invoice row persisted', async () => {
    const fake = makeFakeSupabase({ transactions: [] });
    const counters = await runImportPipeline(fake.client, [makeInvoice()], 'run-1', NO_SKIP);
    expect(counters.skippedUnmatched).toBe(1);
    expect(fake.tables.invoices).toHaveLength(0);
    expect(fake.calls.insertTransactions).toBe(0);
  });
});

describe('runImportPipeline — SC-003 invariant (never creates transactions)', () => {
  it('across a mixed batch, transaction count is unchanged', async () => {
    const fake = makeFakeSupabase({
      transactions: [
        makeTxRow({ id: 'tx-exact', amount: 100, transaction_at: '2025-04-18T00:00:00.000Z' }),
        makeTxRow({ id: 'tx-fx', amount: 295, transaction_at: '2025-04-20T00:00:00.000Z' }),
      ],
    });
    const before = fake.tables.transactions.length;
    const invoices = [
      makeInvoice({ invoice_number: 'M-1', net_amount: 100 }),                       // exact
      makeInvoice({ invoice_number: 'F-1', net_amount: 300, invoice_date: new Date('2025-04-18T00:00:00Z') }), // forex → ambiguous
      makeInvoice({ invoice_number: 'U-1', net_amount: 9999 }),                       // unmatched
    ];
    const counters = await runImportPipeline(fake.client, invoices, 'run-1', NO_SKIP);
    expect(fake.tables.transactions.length).toBe(before);
    expect(fake.calls.insertTransactions).toBe(0);
    expect(counters.matchedExact + counters.matchedNear).toBe(1);
    expect(counters.ambiguous).toBe(1);
    expect(counters.skippedUnmatched).toBe(1);
  });
});

// ─── applyInvoiceItems (FR-008/009) ───────────────────────────────────────────

describe('applyInvoiceItems', () => {
  const invItems = [{ name: 'A', quantity: 1, unit_price: 50, amount: 50 }, { name: 'B', quantity: 1, unit_price: 50, amount: 50 }];

  it('fills when the transaction has no items, stamping provenance', async () => {
    const fake = makeFakeSupabase({ transaction_items: [] });
    const outcome = await applyInvoiceItems(fake.client, 'tx-1', invItems, false, 'inv-1');
    expect(outcome).toBe('filled');
    expect(fake.tables.transaction_items).toHaveLength(2);
    expect(fake.tables.transaction_items.every((i) => i.source_invoice_id === 'inv-1')).toBe(true);
  });

  it('keeps existing items untouched (no replace)', async () => {
    const fake = makeFakeSupabase({ transaction_items: [{ id: 'x', transaction_id: 'tx-1', name: 'keep', amount: 100 }] });
    const outcome = await applyInvoiceItems(fake.client, 'tx-1', invItems, false, 'inv-1');
    expect(outcome).toBe('kept');
    expect(fake.tables.transaction_items.map((i) => i.name)).toEqual(['keep']);
  });

  it('replaces existing items when replace=true', async () => {
    const fake = makeFakeSupabase({ transaction_items: [{ id: 'x', transaction_id: 'tx-1', name: 'old', amount: 100 }] });
    const outcome = await applyInvoiceItems(fake.client, 'tx-1', invItems, true, 'inv-1');
    expect(outcome).toBe('replaced');
  });
});
