import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { periodToDateRange, aggregateByCategory, aggregateBySubcategory } from '../../src/services/summary';
import type { Transaction } from '../../src/types';

function makeTx(amount: number, tags: string[] = []): Transaction {
  return {
    id: crypto.randomUUID(),
    transaction_type: 'expense',
    amount,
    items: null,
    tags,
    payment_method: 'cash',
    wallet: null,
    bank_name: null,
    note: null,
    is_matched: false,
    matched_receipt_id: null,
    parent_transaction_id: null,
    discord_message_id: null,
    invoice_number: null,
    seller_name: null,
    seller_tax_id: null,
    matched_invoice_id: null,
    transaction_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
}

// ─── periodToDateRange ────────────────────────────────────────────────────────

describe('periodToDateRange', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('month → first day of current month to now', () => {
    const { from, to } = periodToDateRange('month');
    expect(from.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(to.getTime()).toBeCloseTo(Date.now(), -2);
  });

  it('last-month → first of prev month to first of this month', () => {
    const { from, to } = periodToDateRange('last-month');
    expect(from.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('3months → 3 months ago same day to now', () => {
    const { from } = periodToDateRange('3months');
    expect(from.toISOString()).toBe('2026-02-15T00:00:00.000Z');
  });

  it('half-year → 6 months ago same day to now', () => {
    const { from } = periodToDateRange('half-year');
    expect(from.toISOString()).toBe('2025-11-15T00:00:00.000Z');
  });

  it('year → 12 months ago same day to now', () => {
    const { from } = periodToDateRange('year');
    expect(from.toISOString()).toBe('2025-05-15T00:00:00.000Z');
  });

  it('all → epoch to now', () => {
    const { from } = periodToDateRange('all');
    expect(from.getTime()).toBe(0);
  });

  it('last-month wraps year correctly when called in January', () => {
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
    const { from, to } = periodToDateRange('last-month');
    expect(from.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

// ─── aggregateByCategory ──────────────────────────────────────────────────────

describe('aggregateByCategory', () => {
  it('(b) correctly groups by first-colon split and sums amounts', () => {
    const txs = [
      makeTx(300, ['食:午餐']),
      makeTx(200, ['食:晚餐']),
      makeTx(150, ['行:捷運']),
    ];
    const result = aggregateByCategory(txs);
    const food = result.find((c) => c.category === '食');
    const transport = result.find((c) => c.category === '行');
    expect(food?.total).toBe(500);
    expect(transport?.total).toBe(150);
  });

  it('(c) no-tag transactions grouped as 其他', () => {
    const txs = [makeTx(100, []), makeTx(200, [])];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('其他');
    expect(result[0].total).toBe(300);
  });

  it('(d) >5 categories → top 5 kept, remainder merged into 其他', () => {
    const txs = [
      makeTx(600, ['食:午餐']),
      makeTx(500, ['行:捷運']),
      makeTx(400, ['住:租金']),
      makeTx(300, ['衣:外套']),
      makeTx(200, ['育:書籍']),
      makeTx(100, ['樂:電影']),
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(6); // top 5 + 其他 for the 6th
    const others = result.find((c) => c.category === '其他');
    expect(others?.total).toBe(100); // 樂:電影 merged into 其他
    // top 5 are 食 行 住 衣 育
    const top5cats = result.filter((c) => c.category !== '其他').map((c) => c.category);
    expect(top5cats).toEqual(['食', '行', '住', '衣', '育']);
  });

  it('(e) single category → one entry', () => {
    const txs = [makeTx(100, ['食:午餐']), makeTx(50, ['食:晚餐'])];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ category: '食', total: 150 });
  });

  it('(f) empty list → []', () => {
    expect(aggregateByCategory([])).toEqual([]);
  });

  it('plain tag (no colon) maps to 其他', () => {
    const txs = [makeTx(80, ['三商巧福'])];
    const result = aggregateByCategory(txs);
    expect(result[0].category).toBe('其他');
  });

  it('sorted descending by total', () => {
    const txs = [makeTx(100, ['行:捷運']), makeTx(500, ['食:午餐'])];
    const result = aggregateByCategory(txs);
    expect(result[0].category).toBe('食');
    expect(result[1].category).toBe('行');
  });
});

// ─── aggregateBySubcategory ───────────────────────────────────────────────────

describe('aggregateBySubcategory', () => {
  it('(g) scopes to matching category and uses post-colon portion', () => {
    const txs = [
      makeTx(300, ['食:午餐']),
      makeTx(200, ['食:晚餐']),
      makeTx(150, ['行:捷運']),
    ];
    const result = aggregateBySubcategory(txs, '食');
    expect(result).toHaveLength(2);
    expect(result.find((s) => s.subcategory === '午餐')?.total).toBe(300);
    expect(result.find((s) => s.subcategory === '晚餐')?.total).toBe(200);
    expect(result.find((s) => s.subcategory === '捷運')).toBeUndefined();
  });

  it('handles multi-colon tag: subcategory includes all portions after first colon', () => {
    const txs = [makeTx(500, ['食:港式:飲茶'])];
    const result = aggregateBySubcategory(txs, '食');
    expect(result[0].subcategory).toBe('港式:飲茶');
  });

  it('transactions with no category tag fall under 其他 when category is 其他', () => {
    const txs = [makeTx(100, []), makeTx(200, ['三商巧福'])];
    const result = aggregateBySubcategory(txs, '其他');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ subcategory: '其他', total: 300 });
  });

  it('returns [] when category has no matching transactions', () => {
    const txs = [makeTx(100, ['食:午餐'])];
    expect(aggregateBySubcategory(txs, '行')).toEqual([]);
  });
});
