import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ParsedInvoice } from '../../src/types';
import { runImportPipeline, computeConfidence, applyInvoiceItems, selectExactDiscountCandidates, selectForexCandidates } from '../../src/services/invoice-matcher';
import { fetchImportCandidateTransactions } from '../../src/db/queries';

// ─── Minimal in-memory fake Supabase ──────────────────────────────────────────
// Supports the chainable subset the pipeline/queries use (select/insert/upsert/update +
// eq/is/in/gte/lte/order/limit/single). Filters are applied against seeded tables
// so the REAL pipeline runs end-to-end. `calls.insertTransactions` lets tests
// assert the SC-003 invariant: the import never creates a transaction; `calls.roundTrips`
// lets tests assert the bulk pipeline's constant subrequest shape (US1/FR-002).

type Row = Record<string, unknown>;

function makeFakeSupabase(seed: { transactions?: Row[]; invoices?: Row[]; transaction_items?: Row[]; transaction_adjustments?: Row[] }) {
  const tables: Record<string, Row[]> = {
    transactions: seed.transactions ?? [],
    invoices: seed.invoices ?? [],
    transaction_items: seed.transaction_items ?? [],
    transaction_adjustments: seed.transaction_adjustments ?? [],
  };
  const calls = { insertTransactions: 0, roundTrips: 0 };
  let idCounter = 1;

  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
    let insertRows: Row[] = [];
    let updatePatch: Row = {};
    let wantSingle = false;
    let limitN: number | null = null;

    function execute() {
      calls.roundTrips += 1;
      if (mode === 'insert') {
        const created = insertRows.map((r) => ({ id: `gen-${idCounter++}`, ...r }));
        tables[table].push(...created);
        if (table === 'transactions') calls.insertTransactions += created.length;
        return wantSingle ? { data: created[0], error: null } : { data: created, error: null };
      }
      if (mode === 'upsert') {
        // Insert-or-update by `id` (PostgREST onConflict default = PK).
        const result: Row[] = [];
        for (const r of insertRows) {
          const existing = r.id != null ? tables[table].find((x) => x.id === r.id) : undefined;
          if (existing) { Object.assign(existing, r); result.push(existing); }
          else {
            const row = { id: r.id ?? `gen-${idCounter++}`, ...r };
            tables[table].push(row);
            if (table === 'transactions') calls.insertTransactions += 1;
            result.push(row);
          }
        }
        return wantSingle ? { data: result[0], error: null } : { data: result, error: null };
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
      let rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (limitN != null) rows = rows.slice(0, limitN);
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
      upsert(rows: Row | Row[]) {
        mode = 'upsert';
        insertRows = Array.isArray(rows) ? rows : [rows];
        return builder;
      },
      update(patch: Row) { mode = 'update'; updatePatch = patch; return builder; },
      delete() { mode = 'delete'; return builder; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
      is(col: string, val: unknown) { filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return builder; },
      in(col: string, arr: unknown[]) { filters.push((r) => arr.includes(r[col])); return builder; },
      gte(col: string, val: unknown) { filters.push((r) => (typeof r[col] === 'number' && typeof val === 'number') ? (r[col] as number) >= (val as number) : String(r[col]) >= String(val)); return builder; },
      lte(col: string, val: unknown) { filters.push((r) => (typeof r[col] === 'number' && typeof val === 'number') ? (r[col] as number) <= (val as number) : String(r[col]) <= String(val)); return builder; },
      order() { return builder; },
      limit(n: number) { limitN = n; return builder; },
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

// ─── runImportPipeline — discount-aware matching (US2) ────────────────────────

describe('runImportPipeline — discount-aware matching (US2)', () => {
  it('auto-links a discounted expense (paid + discount = net) as near', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-35', amount: 35, transaction_at: '2026-04-19T08:00:00.000Z' })],
      transaction_adjustments: [{ id: 'adj-1', transaction_id: 'tx-35', kind: 'discount', amount: 5 }],
    });
    const invoice = makeInvoice({ invoice_number: 'D-1', net_amount: 40, invoice_date: new Date('2026-04-19T00:00:00Z') });
    const counters = await runImportPipeline(fake.client, [invoice], 'run-1', NO_SKIP);

    expect(counters.matchedNear).toBe(1);
    expect(counters.matched[0]).toMatchObject({ confidence: 'near', invoice_number: 'D-1' });
    expect(fake.tables.transactions[0].matched_invoice_id).not.toBeNull();
    expect(fake.calls.insertTransactions).toBe(0); // SC-003
  });

  it('a tx with no discount still matches on paid amount exactly (regression)', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-180', amount: 180, transaction_at: '2025-04-18T08:00:00.000Z' })],
    });
    const counters = await runImportPipeline(fake.client, [makeInvoice()], 'run-1', NO_SKIP);
    expect(counters.matchedExact).toBe(1);
    expect(counters.matched[0].confidence).toBe('exact');
  });

  it('a below-net tx with NO discount is not a candidate (paid-only behavior intact)', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-35', amount: 35, transaction_at: '2026-04-19T08:00:00.000Z' })],
    });
    const invoice = makeInvoice({ invoice_number: 'N-1', net_amount: 40, invoice_date: new Date('2026-04-19T00:00:00Z') });
    const counters = await runImportPipeline(fake.client, [invoice], 'run-1', NO_SKIP);
    // 35 ≠ 40, no discount; 35 also outside ±5% forex of 40 → skipped, never matched.
    expect(counters.matchedExact + counters.matchedNear).toBe(0);
    expect(counters.ambiguous).toBe(0);
    expect(counters.skippedUnmatched).toBe(1);
  });

  it('two candidates (one paid-exact, one discount-gross) → ambiguous, none linked', async () => {
    const fake = makeFakeSupabase({
      transactions: [
        makeTxRow({ id: 'tx-exact', amount: 40, transaction_at: '2026-04-19T08:00:00.000Z' }),
        makeTxRow({ id: 'tx-gross', amount: 35, transaction_at: '2026-04-19T09:00:00.000Z' }),
      ],
      transaction_adjustments: [{ id: 'adj-1', transaction_id: 'tx-gross', kind: 'discount', amount: 5 }],
    });
    const invoice = makeInvoice({ invoice_number: 'A-1', net_amount: 40, invoice_date: new Date('2026-04-19T00:00:00Z') });
    const counters = await runImportPipeline(fake.client, [invoice], 'run-1', NO_SKIP);

    expect(counters.ambiguous).toBe(1);
    expect(fake.tables.transactions.every((t) => t.matched_invoice_id === null)).toBe(true);
    expect(fake.calls.insertTransactions).toBe(0); // SC-003
  });

  it('discount-aware import never changes the transaction count (SC-003)', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-35', amount: 35, transaction_at: '2026-04-19T08:00:00.000Z' })],
      transaction_adjustments: [{ id: 'adj-1', transaction_id: 'tx-35', kind: 'discount', amount: 5 }],
    });
    const before = fake.tables.transactions.length;
    await runImportPipeline(
      fake.client,
      [makeInvoice({ invoice_number: 'D-2', net_amount: 40, invoice_date: new Date('2026-04-19T00:00:00Z') })],
      'run-1',
      NO_SKIP
    );
    expect(fake.tables.transactions.length).toBe(before);
    expect(fake.calls.insertTransactions).toBe(0);
  });
});

// ─── consumed-set: no double-link within one run (US1/US2 · SC-005) ───────────

describe('runImportPipeline — consumed transaction not reused (SC-005)', () => {
  it('two invoices that could match the same single tx → only one links, the other falls through', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-180', amount: 180, transaction_at: '2025-04-18T08:00:00.000Z' })],
    });
    const invoices = [
      makeInvoice({ invoice_number: 'M-1' }),
      makeInvoice({ invoice_number: 'M-2' }),
    ];
    const counters = await runImportPipeline(fake.client, invoices, 'run-1', NO_SKIP);

    // First invoice links tx-180; second sees it consumed → no exact, and forex also
    // excludes the consumed tx → skipped_unmatched (matches the prior sequential DB behavior).
    expect(counters.matchedExact).toBe(1);
    expect(counters.skippedUnmatched).toBe(1);
    expect(counters.ambiguous).toBe(0);
    const linked = fake.tables.transactions.filter((t) => t.matched_invoice_id !== null);
    expect(linked).toHaveLength(1);
    expect(fake.calls.insertTransactions).toBe(0);
  });
});

// ─── US1: subrequest shape is constant in invoice count (FR-002) ──────────────

describe('runImportPipeline — bounded subrequests (US1/FR-002)', () => {
  function manyMatches(n: number) {
    // Each invoice has a unique net + a single tx of that amount on the same day → 1:1 match.
    const transactions = Array.from({ length: n }, (_, i) =>
      makeTxRow({ id: `tx-${i}`, amount: 100 + i, transaction_at: '2025-04-18T08:00:00.000Z' })
    );
    const invoices = Array.from({ length: n }, (_, i) =>
      makeInvoice({ invoice_number: `M-${i}`, gross_amount: 100 + i, net_amount: 100 + i })
    );
    return { transactions, invoices };
  }

  it('round-trip count does not grow with the number of invoices', async () => {
    const a = manyMatches(5);
    const small = makeFakeSupabase({ transactions: a.transactions });
    await runImportPipeline(small.client, a.invoices, 'run-1', NO_SKIP);

    const b = manyMatches(30);
    const big = makeFakeSupabase({ transactions: b.transactions });
    const counters = await runImportPipeline(big.client, b.invoices, 'run-1', NO_SKIP);

    expect(counters.matchedExact).toBe(30);
    expect(big.calls.roundTrips).toBe(small.calls.roundTrips); // constant in N
    expect(big.calls.roundTrips).toBeLessThanOrEqual(8);
    expect(big.calls.insertTransactions).toBe(0); // SC-003
  });
});

// ─── US1: truncation guard aborts before matching/writes (FR-012) ─────────────

describe('runImportPipeline — candidate read truncation guard (FR-012)', () => {
  it('aborts with no writes when the candidate window overflows the page limit', async () => {
    const transactions = Array.from({ length: 1001 }, (_, i) =>
      makeTxRow({ id: `tx-${i}`, amount: 1, transaction_at: '2025-04-18T08:00:00.000Z' })
    );
    const fake = makeFakeSupabase({ transactions });

    await expect(runImportPipeline(fake.client, [makeInvoice()], 'run-1', NO_SKIP)).rejects.toThrow(/more than 1000|truncated/);
    expect(fake.tables.invoices).toHaveLength(0);
    expect(fake.calls.insertTransactions).toBe(0);
  });
});

// ─── GET /import/ambiguous matching composition (US1 · research Decision 6) ────

describe('ambiguous-list candidate composition', () => {
  it('pre-fetched pool excludes already-linked txs; exact-first then forex fallback', async () => {
    const fake = makeFakeSupabase({
      transactions: [
        makeTxRow({ id: 'tx-exact', amount: 180, transaction_at: '2025-04-18T08:00:00.000Z' }),
        makeTxRow({ id: 'tx-fx', amount: 175, transaction_at: '2025-04-23T08:00:00.000Z' }),
        makeTxRow({ id: 'tx-linked', amount: 180, matched_invoice_id: 'inv-x', transaction_at: '2025-04-18T09:00:00.000Z' }),
      ],
    });

    const pool = await fetchImportCandidateTransactions(fake.client, '2025-04-11', '2025-04-25T23:59:59Z');
    // A transaction linked since import drops out of the candidate pool.
    expect(pool.map((t) => t.id).sort()).toEqual(['tx-exact', 'tx-fx']);

    const date = new Date('2025-04-18T00:00:00Z');
    const noConsumed = new Set<string>();

    // Exact present → that is the candidate source.
    expect(selectExactDiscountCandidates(180, date, pool, new Map(), noConsumed).map((t) => t.id)).toEqual(['tx-exact']);

    // With no exact candidate, forex fallback surfaces the ±5%/±7-day match.
    const poolNoExact = pool.filter((t) => t.id !== 'tx-exact');
    expect(selectExactDiscountCandidates(180, date, poolNoExact, new Map(), noConsumed)).toHaveLength(0);
    expect(selectForexCandidates(180, date, poolNoExact, noConsumed).map((t) => t.id)).toEqual(['tx-fx']);
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

// ─── runImportPipeline — discount-aware fill (US2, feature 025) ────────────────

describe('runImportPipeline — net effective_amount on fill (US2)', () => {
  it('discounted invoice fill stamps net effective_amount summing to the paid amount', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-900', amount: 900, transaction_at: '2025-04-18T08:00:00.000Z' })],
    });
    const invoice = makeInvoice({
      gross_amount: 1000,
      allowance: 100,
      net_amount: 900,
      items: [
        { name: 'A', quantity: 1, unit_price: 600, amount: 600 },
        { name: 'B', quantity: 1, unit_price: 400, amount: 400 },
      ],
    });
    const counters = await runImportPipeline(fake.client, [invoice], 'run-1', NO_SKIP);

    expect(counters.matchedExact).toBe(1);
    expect(counters.matched[0].items_outcome).toBe('filled');
    const items = fake.tables.transaction_items.filter((i) => i.transaction_id === 'tx-900');
    const a = items.find((i) => i.name === 'A')!;
    const b = items.find((i) => i.name === 'B')!;
    expect(a.effective_amount).toBe(540); // 600/1000 × 900
    expect(b.effective_amount).toBe(360); // 400/1000 × 900
    expect((a.effective_amount as number) + (b.effective_amount as number)).toBe(900); // sums to paid (SC-001)
  });

  it('non-discounted invoice fill → effective_amount equals face amount (no regression, SC-003)', async () => {
    const fake = makeFakeSupabase({
      transactions: [makeTxRow({ id: 'tx-180', amount: 180, transaction_at: '2025-04-18T08:00:00.000Z' })],
    });
    const invoice = makeInvoice({ items: [{ name: '咖啡', quantity: 1, unit_price: 180, amount: 180 }] });
    await runImportPipeline(fake.client, [invoice], 'run-1', NO_SKIP);
    expect(fake.tables.transaction_items.find((i) => i.name === '咖啡')!.effective_amount).toBe(180);
  });
});
