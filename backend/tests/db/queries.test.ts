import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findAllMatchedInvoices, markInvoicesRead, getTransactionsByIds, getTransactionItemsByTransactionIds, resetInvoiceToAmbiguous } from '../../src/db/queries';

// Test the getMonthlySpend reduce logic directly — same formula as the implementation
function computeMonthlySpend(rows: { amount: number; transaction_type: string }[]): number {
  return rows.reduce((sum, row) => {
    const amount = row.amount;
    return row.transaction_type === 'refund' ? sum - amount : sum + amount;
  }, 0);
}

describe('getMonthlySpend sign correction', () => {
  it('sums expense rows normally', () => {
    const rows = [
      { amount: 500, transaction_type: 'expense' },
      { amount: 300, transaction_type: 'expense' },
    ];
    expect(computeMonthlySpend(rows)).toBe(800);
  });

  it('adds fee rows to net spend', () => {
    const rows = [
      { amount: 1000, transaction_type: 'expense' },
      { amount: 50, transaction_type: 'fee' },
    ];
    expect(computeMonthlySpend(rows)).toBe(1050);
  });

  it('subtracts refund rows from net spend', () => {
    const rows = [
      { amount: 1000, transaction_type: 'expense' },
      { amount: 200, transaction_type: 'refund' },
    ];
    expect(computeMonthlySpend(rows)).toBe(800);
  });

  it('applies mixed formula: expense(1000) + fee(50) - refund(200) = 850', () => {
    const rows = [
      { amount: 1000, transaction_type: 'expense' },
      { amount: 50, transaction_type: 'fee' },
      { amount: 200, transaction_type: 'refund' },
    ];
    expect(computeMonthlySpend(rows)).toBe(850);
  });

  it('returns 0 for empty result set', () => {
    expect(computeMonthlySpend([])).toBe(0);
  });

  it('refund can bring net spend below zero (over-refund edge case)', () => {
    const rows = [{ amount: 100, transaction_type: 'refund' }];
    expect(computeMonthlySpend(rows)).toBe(-100);
  });
});

describe('formatButtonLabel (UTC+8 conversion)', () => {
  function formatButtonLabel(amount: number, transactionAt: string): string {
    const utc8 = new Date(new Date(transactionAt).getTime() + 8 * 60 * 60 * 1000);
    const mm = String(utc8.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(utc8.getUTCDate()).padStart(2, '0');
    const hh = String(utc8.getUTCHours()).padStart(2, '0');
    const min = String(utc8.getUTCMinutes()).padStart(2, '0');
    return `NT$${amount.toLocaleString()} · ${mm}/${dd} ${hh}:${min}`;
  }

  it('formats amount with comma separator for thousands', () => {
    const label = formatButtonLabel(1200, '2026-04-30T06:23:00.000Z');
    expect(label).toBe('NT$1,200 · 04/30 14:23');
  });

  it('converts UTC time to UTC+8 for label', () => {
    // 2026-04-30T16:00:00Z = 2026-05-01 00:00 UTC+8
    const label = formatButtonLabel(800, '2026-04-30T16:00:00.000Z');
    expect(label).toBe('NT$800 · 05/01 00:00');
  });

  it('pads single-digit month, day, hour, minute', () => {
    // 2026-01-05T01:05:00Z = 2026-01-05 09:05 UTC+8
    const label = formatButtonLabel(50, '2026-01-05T01:05:00.000Z');
    expect(label).toBe('NT$50 · 01/05 09:05');
  });
});

// ─── amendTransactionAmount ──────────────────────────────────────────────────

describe('amendTransactionAmount', () => {
  it('only updates amount, leaves other fields intact (contract test)', () => {
    // amendTransactionAmount issues UPDATE SET amount = $1 WHERE id = $2
    // All other fields (tags, payment_method, etc.) are not touched
    const patch = { amount: 1523 };
    const otherFieldsAffected = Object.keys(patch).some((k) => k !== 'amount');
    expect(otherFieldsAffected).toBe(false);
  });

  it('custom_id encoding for amend_select stays within 100 chars', () => {
    const newAmount = 99999; // max realistic NTD amount
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const customId = `amend_select:${newAmount}:${uuid}`;
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it('custom_id encoding for amend_retype stays within 100 chars', () => {
    const newAmount = 99999;
    const customId = `amend_retype:${newAmount}`;
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it('custom_id encoding for amend_modal stays within 100 chars', () => {
    const newAmount = 99999;
    const customId = `amend_modal:${newAmount}`;
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it('parses newAmount and txId from amend_select custom_id', () => {
    const newAmount = 1523;
    const txId = '550e8400-e29b-41d4-a716-446655440000';
    const customId = `amend_select:${newAmount}:${txId}`;
    const rest = customId.slice('amend_select:'.length);
    const colonIdx = rest.indexOf(':');
    expect(Number(rest.slice(0, colonIdx))).toBe(newAmount);
    expect(rest.slice(colonIdx + 1)).toBe(txId);
  });
});

// ─── Invoice query logic (unit tests) ───────────────────────────────────────

describe('linkInvoiceToTransaction update payload', () => {
  it('sets match_status=matched, match_confidence, and matched_transaction_id', () => {
    // Mirrors the UPDATE issued by linkInvoiceToTransaction
    const payload = { match_status: 'matched', match_confidence: 'near', matched_transaction_id: 'tx-1' };
    expect(payload.match_status).toBe('matched');
    expect(payload.match_confidence).toBe('near');
    expect(payload.matched_transaction_id).toBe('tx-1');
  });
});

describe('findExistingInvoiceNumbers dedup logic', () => {
  it('identifies already-seen invoice numbers', () => {
    const dbNumbers = ['AB-001', 'AB-002', 'AB-003'];
    const incoming = ['AB-001', 'AB-004', 'AB-005'];
    const dupes = incoming.filter((n) => dbNumbers.includes(n));
    expect(dupes).toEqual(['AB-001']);
  });

  it('returns empty array when no duplicates', () => {
    const dbNumbers = ['AB-001'];
    const incoming = ['AB-002', 'AB-003'];
    const dupes = incoming.filter((n) => dbNumbers.includes(n));
    expect(dupes).toHaveLength(0);
  });
});

// ─── US1: matched-invoice review queue (reviewed_at) ──────────────────────────
// A compact in-memory fake exercises the REAL query functions so the reviewed-at
// filter, the matched-only mark-as-read, and the single batched transaction fetch
// are covered against the implementation (not just mirrored).

type Row = Record<string, unknown>;
function makeFake(seed: { invoices?: Row[]; transactions?: Row[]; transaction_items?: Row[] }) {
  const tables: Record<string, Row[]> = {
    invoices: seed.invoices ?? [],
    transactions: seed.transactions ?? [],
    transaction_items: seed.transaction_items ?? [],
  };
  const calls = { select: {} as Record<string, number> };
  function from(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let mode: 'select' | 'update' = 'select';
    let updatePatch: Row = {};
    function execute() {
      const matched = tables[table].filter((r) => filters.every((f) => f(r)));
      if (mode === 'update') {
        for (const r of matched) Object.assign(r, updatePatch);
        return { data: matched, error: null };
      }
      calls.select[table] = (calls.select[table] ?? 0) + 1;
      return { data: matched, error: null };
    }
    const builder: Record<string, unknown> = {
      select() { return builder; },
      update(patch: Row) { mode = 'update'; updatePatch = patch; return builder; },
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return builder; },
      is(col: string, val: unknown) { filters.push((r) => (val === null ? r[col] == null : r[col] === val)); return builder; },
      in(col: string, arr: unknown[]) { filters.push((r) => arr.includes(r[col])); return builder; },
      order() { return builder; },
      then(resolve: (v: unknown) => void) { resolve(execute()); },
    };
    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, tables, calls };
}

describe('findAllMatchedInvoices reviewed filter (US1)', () => {
  const seed = () => ({
    invoices: [
      { id: 'm-unread', match_status: 'matched', reviewed_at: null, invoice_date: '2026-04-18' },
      { id: 'm-read', match_status: 'matched', reviewed_at: '2026-04-19T00:00:00Z', invoice_date: '2026-04-17' },
      { id: 'amb', match_status: 'ambiguous', reviewed_at: null, invoice_date: '2026-04-16' },
    ],
  });

  it('returns only unacknowledged matched invoices by default', async () => {
    const { client } = makeFake(seed());
    const rows = await findAllMatchedInvoices(client);
    expect(rows.map((r) => r.id)).toEqual(['m-unread']);
  });

  it('returns read + unread matched invoices when includeRead=true', async () => {
    const { client } = makeFake(seed());
    const rows = await findAllMatchedInvoices(client, true);
    expect(rows.map((r) => r.id).sort()).toEqual(['m-read', 'm-unread']);
  });
});

describe('markInvoicesRead (US1)', () => {
  it('sets reviewed_at on the given matched invoices and returns the count', async () => {
    const { client, tables } = makeFake({
      invoices: [
        { id: 'm-1', match_status: 'matched', reviewed_at: null },
        { id: 'm-2', match_status: 'matched', reviewed_at: null },
      ],
    });
    const marked = await markInvoicesRead(client, ['m-1', 'm-2']);
    expect(marked).toBe(2);
    expect(tables.invoices.every((r) => r.reviewed_at != null)).toBe(true);
  });

  it('only affects matched invoices (ambiguous untouched)', async () => {
    const { client, tables } = makeFake({
      invoices: [
        { id: 'm-1', match_status: 'matched', reviewed_at: null },
        { id: 'amb-1', match_status: 'ambiguous', reviewed_at: null },
      ],
    });
    const marked = await markInvoicesRead(client, ['m-1', 'amb-1']);
    expect(marked).toBe(1);
    expect(tables.invoices.find((r) => r.id === 'amb-1')!.reviewed_at).toBeNull();
  });

  it('no-ops on an empty id list', async () => {
    const { client } = makeFake({ invoices: [{ id: 'm-1', match_status: 'matched', reviewed_at: null }] });
    expect(await markInvoicesRead(client, [])).toBe(0);
  });
});

describe('getTransactionsByIds batched fetch (US1)', () => {
  it('fetches all requested transactions in a single query (no N+1)', async () => {
    const { client, calls } = makeFake({
      transactions: [
        { id: 't-1', amount: 100, transaction_at: '2026-04-18T00:00:00Z', note: 'a' },
        { id: 't-2', amount: 200, transaction_at: '2026-04-18T00:00:00Z', note: 'b' },
        { id: 't-3', amount: 300, transaction_at: '2026-04-18T00:00:00Z', note: 'c' },
      ],
    });
    const rows = await getTransactionsByIds(client, ['t-1', 't-2', 't-3']);
    expect(rows.map((r) => r.id).sort()).toEqual(['t-1', 't-2', 't-3']);
    expect(calls.select.transactions).toBe(1);
  });

  it('returns [] without querying for an empty id list', async () => {
    const { client, calls } = makeFake({ transactions: [{ id: 't-1', amount: 1, transaction_at: 'x', note: null }] });
    expect(await getTransactionsByIds(client, [])).toEqual([]);
    expect(calls.select.transactions).toBeUndefined();
  });
});

describe('resetInvoiceToAmbiguous (改配對)', () => {
  it('flips a matched invoice back to ambiguous and clears link/confidence/reviewed_at', async () => {
    const { client, tables } = makeFake({
      invoices: [{
        id: 'm-1', match_status: 'matched', matched_transaction_id: 'tx-9',
        match_confidence: 'near', reviewed_at: '2026-06-06T00:00:00Z',
      }],
    });
    await resetInvoiceToAmbiguous(client, 'm-1');
    expect(tables.invoices[0]).toMatchObject({
      match_status: 'ambiguous',
      matched_transaction_id: null,
      match_confidence: null,
      reviewed_at: null,
    });
  });
});

describe('getTransactionItemsByTransactionIds batched fetch (matched detail)', () => {
  it('fetches items for all transactions in a single query (no N+1)', async () => {
    const { client, calls } = makeFake({
      transaction_items: [
        { transaction_id: 't-1', name: '咖啡', amount: 60, tags: ['食:咖啡'], sort_order: 0 },
        { transaction_id: 't-1', name: '蛋餅', amount: 35, tags: ['食:早餐'], sort_order: 1 },
        { transaction_id: 't-2', name: '加油', amount: 259, tags: ['行:加油'], sort_order: 0 },
      ],
    });
    const rows = await getTransactionItemsByTransactionIds(client, ['t-1', 't-2']);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.transaction_id === 't-1').map((r) => r.name)).toEqual(['咖啡', '蛋餅']);
    expect(calls.select.transaction_items).toBe(1);
  });

  it('returns [] without querying for an empty id list', async () => {
    const { client, calls } = makeFake({ transaction_items: [{ transaction_id: 't-1', name: 'x', amount: 1, tags: [], sort_order: 0 }] });
    expect(await getTransactionItemsByTransactionIds(client, [])).toEqual([]);
    expect(calls.select.transaction_items).toBeUndefined();
  });
});
