import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { periodToDateRange, aggregateByCategory, aggregateBySubcategory, buildCategoryEmbedFields } from '../../src/services/summary';

// Helper: build a TxForSummary with one item per tag (carrying that item's full amount)
function tx(amount: number, itemTags: string[][]): { amount: number; tags: string[]; transaction_items: { amount: number; tags: string[] }[] } {
  if (itemTags.length === 0) {
    return { amount, tags: [], transaction_items: [] };
  }
  const perItem = Math.floor(amount / itemTags.length);
  return {
    amount,
    tags: [],
    transaction_items: itemTags.map((tags, i) => ({
      amount: i === itemTags.length - 1 ? amount - perItem * i : perItem,
      tags,
    })),
  };
}

// Simple single-item helper
function txSingle(amount: number, tag: string): { amount: number; tags: string[]; transaction_items: { amount: number; tags: string[] }[] } {
  return { amount, tags: [], transaction_items: [{ amount, tags: tag ? [tag] : [] }] };
}

// ─── periodToDateRange ────────────────────────────────────────────────────────

describe('periodToDateRange', () => {
  const FIXED_NOW = new Date('2026-05-10T12:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('all → start=epoch(0), end=now', () => {
    const { start, end } = periodToDateRange('all');
    expect(start.getTime()).toBe(0);
    expect(end.getTime()).toBe(FIXED_NOW.getTime());
  });

  it('month → start=2026-05-01T00:00:00Z, end=now', () => {
    const { start, end } = periodToDateRange('month');
    expect(start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(end.getTime()).toBe(FIXED_NOW.getTime());
  });

  it('last-month → 2026-04-01 to 2026-05-01 (exclusive)', () => {
    const { start, end } = periodToDateRange('last-month');
    expect(start.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('3months → 3 months ago same day, end=now', () => {
    const { start, end } = periodToDateRange('3months');
    expect(start.toISOString()).toBe('2026-02-10T00:00:00.000Z');
    expect(end.getTime()).toBe(FIXED_NOW.getTime());
  });

  it('half-year → 6 months ago same day, end=now', () => {
    const { start, end } = periodToDateRange('half-year');
    expect(start.toISOString()).toBe('2025-11-10T00:00:00.000Z');
    expect(end.getTime()).toBe(FIXED_NOW.getTime());
  });

  it('year → 12 months ago same day, end=now', () => {
    const { start, end } = periodToDateRange('year');
    expect(start.toISOString()).toBe('2025-05-10T00:00:00.000Z');
    expect(end.getTime()).toBe(FIXED_NOW.getTime());
  });
});

// ─── aggregateByCategory ──────────────────────────────────────────────────────

describe('aggregateByCategory', () => {
  it('empty transactions → []', () => {
    expect(aggregateByCategory([])).toEqual([]);
  });

  it('groups by category tag (text before first colon)', () => {
    const txs = [
      txSingle(300, '食:午餐'),
      txSingle(100, '食:晚餐'),
      txSingle(200, '行:捷運'),
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(2);
    expect(result.find((t) => t.category === '食')?.total).toBe(400);
    expect(result.find((t) => t.category === '行')?.total).toBe(200);
  });

  it('no items → full amount under 其他', () => {
    const txs = [{ amount: 100, tags: [], transaction_items: [] }];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('其他');
    expect(result[0].total).toBe(100);
  });

  it('item with plain tag (no colon) → amount goes to 其他', () => {
    const txs = [{ amount: 80, tags: [], transaction_items: [{ amount: 80, tags: ['三商巧福'] }] }];
    const result = aggregateByCategory(txs);
    expect(result[0].category).toBe('其他');
    expect(result[0].total).toBe(80);
  });

  it('item with null amount → full transaction amount falls to 其他', () => {
    const txs = [{ amount: 120, tags: [], transaction_items: [{ amount: null as unknown as number, tags: ['食:午餐'] }] }];
    const result = aggregateByCategory(txs);
    expect(result[0].category).toBe('其他');
    expect(result[0].total).toBe(120);
  });

  it('sorted descending by total', () => {
    const txs = [
      txSingle(100, 'A:x'),
      txSingle(300, 'B:x'),
      txSingle(200, 'C:x'),
    ];
    const result = aggregateByCategory(txs);
    expect(result[0].total).toBe(300);
    expect(result[1].total).toBe(200);
    expect(result[2].total).toBe(100);
  });

  it('>5 named categories → caps at 5, merges overflow into 其他', () => {
    const txs = [
      txSingle(600, 'A:x'),
      txSingle(500, 'B:x'),
      txSingle(400, 'C:x'),
      txSingle(300, 'D:x'),
      txSingle(200, 'E:x'),
      txSingle(100, 'F:x'),
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(5);
    const qita = result.find((t) => t.category === '其他');
    expect(qita?.total).toBe(300); // E(200) + F(100)
    expect(result.find((t) => t.category === 'A')?.total).toBe(600);
    expect(result.find((t) => t.category === 'D')?.total).toBe(300);
    expect(result.find((t) => t.category === 'E')).toBeUndefined();
    expect(result.find((t) => t.category === 'F')).toBeUndefined();
  });

  it('natural 其他 + >4 named → 其他 includes natural total + overflow', () => {
    const txs = [
      txSingle(600, 'A:x'),
      txSingle(500, 'B:x'),
      txSingle(400, 'C:x'),
      txSingle(300, 'D:x'),
      txSingle(200, 'E:x'),
      { amount: 100, tags: [], transaction_items: [] }, // natural 其他
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(5);
    const qita = result.find((t) => t.category === '其他');
    // natural 其他(100) + overflow E(200) = 300
    expect(qita?.total).toBe(300);
  });

  it('exactly 5 categories → returns all 5', () => {
    const txs = [
      txSingle(500, 'A:x'),
      txSingle(400, 'B:x'),
      txSingle(300, 'C:x'),
      txSingle(200, 'D:x'),
      txSingle(100, 'E:x'),
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(5);
    expect(result.find((t) => t.category === 'E')).toBeDefined();
  });
});

// ─── aggregateBySubcategory ───────────────────────────────────────────────────

describe('aggregateBySubcategory', () => {
  it('groups by subcategory (after first colon)', () => {
    const txs = [
      txSingle(200, '食:午餐'),
      txSingle(150, '食:晚餐'),
      txSingle(100, '食:午餐'),
    ];
    const result = aggregateBySubcategory(txs, '食');
    expect(result.find((t) => t.subcategory === '午餐')?.total).toBe(300);
    expect(result.find((t) => t.subcategory === '晚餐')?.total).toBe(150);
  });

  it('plain tag (no colon) → subcategory is 其他', () => {
    const txs = [{ amount: 80, tags: [], transaction_items: [{ amount: 80, tags: ['三商巧福'] }] }];
    const result = aggregateBySubcategory(txs, '其他');
    expect(result[0].subcategory).toBe('其他');
    expect(result[0].total).toBe(80);
  });

  it('multi-colon tag → subcategory is everything after first colon', () => {
    const txs = [txSingle(300, '食:港式:飲茶')];
    const result = aggregateBySubcategory(txs, '食');
    expect(result[0].subcategory).toBe('港式:飲茶');
  });

  it('sorted descending by total', () => {
    const txs = [
      txSingle(100, '食:晚餐'),
      txSingle(300, '食:午餐'),
    ];
    const result = aggregateBySubcategory(txs, '食');
    expect(result[0].subcategory).toBe('午餐');
    expect(result[1].subcategory).toBe('晚餐');
  });
});

// ─── buildCategoryEmbedFields ─────────────────────────────────────────────────

describe('buildCategoryEmbedFields', () => {
  it('returns inline fields with amount and percentage', () => {
    const totals = [
      { category: '食', total: 300 },
      { category: '行', total: 200 },
      { category: '其他', total: 500 },
    ];
    const fields = buildCategoryEmbedFields(totals);
    expect(fields).toHaveLength(3);
    expect(fields[0]).toEqual({ name: '食', value: 'NT$300 (30%)', inline: true });
    expect(fields[2]).toEqual({ name: '其他', value: 'NT$500 (50%)', inline: true });
  });

  it('percentages round to integer', () => {
    const totals = [
      { category: '食', total: 400 },
      { category: '行', total: 600 },
    ];
    const fields = buildCategoryEmbedFields(totals);
    expect(fields[0].value).toContain('40%');
    expect(fields[1].value).toContain('60%');
  });
});
