import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { periodToDateRange, aggregateByCategory, aggregateBySubcategory, mergeOverflowCategories, buildCategoryEmbedFields } from '../../src/services/summary';

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

  it('>5 named categories → returns all, sorted, no 其他 merge', () => {
    const txs = [
      txSingle(600, 'A:x'),
      txSingle(500, 'B:x'),
      txSingle(400, 'C:x'),
      txSingle(300, 'D:x'),
      txSingle(200, 'E:x'),
      txSingle(100, 'F:x'),
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(6);
    expect(result.find((t) => t.category === 'E')?.total).toBe(200);
    expect(result.find((t) => t.category === 'F')?.total).toBe(100);
    expect(result.find((t) => t.category === '其他')).toBeUndefined();
  });

  it('natural 其他 + >4 named → every category kept separately (no overflow merge)', () => {
    const txs = [
      txSingle(600, 'A:x'),
      txSingle(500, 'B:x'),
      txSingle(400, 'C:x'),
      txSingle(300, 'D:x'),
      txSingle(200, 'E:x'),
      { amount: 100, tags: [], transaction_items: [] }, // natural 其他
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(6);
    expect(result.find((t) => t.category === 'E')?.total).toBe(200);
    expect(result.find((t) => t.category === '其他')?.total).toBe(100);
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

// ─── mergeOverflowCategories (Discord embed cap) ──────────────────────────────

describe('mergeOverflowCategories', () => {
  it('≤5 categories → returned unchanged', () => {
    const raw = [
      { category: 'A', total: 500 },
      { category: 'B', total: 400 },
      { category: 'C', total: 300 },
    ];
    expect(mergeOverflowCategories(raw)).toHaveLength(3);
  });

  it('>5 categories → caps at top-4 named + 其他 overflow', () => {
    const raw = [
      { category: 'A', total: 600 },
      { category: 'B', total: 500 },
      { category: 'C', total: 400 },
      { category: 'D', total: 300 },
      { category: 'E', total: 200 },
      { category: 'F', total: 100 },
    ];
    const result = mergeOverflowCategories(raw);
    expect(result).toHaveLength(5);
    expect(result.find((t) => t.category === '其他')?.total).toBe(300); // E(200)+F(100)
    expect(result.find((t) => t.category === 'E')).toBeUndefined();
    expect(result.find((t) => t.category === 'F')).toBeUndefined();
  });

  it('natural 其他 total folds into the overflow bucket', () => {
    const raw = [
      { category: 'A', total: 600 },
      { category: 'B', total: 500 },
      { category: 'C', total: 400 },
      { category: 'D', total: 300 },
      { category: 'E', total: 200 },
      { category: '其他', total: 100 },
    ];
    const result = mergeOverflowCategories(raw);
    expect(result).toHaveLength(5);
    expect(result.find((t) => t.category === '其他')?.total).toBe(300); // natural(100)+E(200)
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

// ─── discount-aware aggregation: effective_amount over face amount (feature 025) ──

describe('aggregateByCategory — discount-aware (effective_amount)', () => {
  it('counts net effective_amount, not gross face amount, for a discounted multi-category tx', () => {
    const txs = [{
      amount: 900,
      tags: [],
      transaction_items: [
        { amount: 600, effective_amount: 540, tags: ['日:洗髮精'] },
        { amount: 400, effective_amount: 360, tags: ['飲:零食'] },
      ],
    }];
    const result = aggregateByCategory(txs);
    expect(result.find((t) => t.category === '日')?.total).toBe(540);
    expect(result.find((t) => t.category === '飲')?.total).toBe(360);
    // categories sum to the paid amount → ≤ grand total (SC-001 / SC-002)
    expect(result.reduce((s, c) => s + c.total, 0)).toBe(900);
  });

  it('effective_amount == amount (non-discounted) → unchanged (SC-003)', () => {
    const txs = [{
      amount: 500,
      tags: [],
      transaction_items: [
        { amount: 300, effective_amount: 300, tags: ['日:x'] },
        { amount: 200, effective_amount: 200, tags: ['飲:y'] },
      ],
    }];
    const result = aggregateByCategory(txs);
    expect(result.find((t) => t.category === '日')?.total).toBe(300);
    expect(result.find((t) => t.category === '飲')?.total).toBe(200);
  });

  it('null effective_amount falls back to face amount', () => {
    const txs = [{ amount: 100, tags: [], transaction_items: [{ amount: 100, effective_amount: null, tags: ['日:x'] }] }];
    expect(aggregateByCategory(txs).find((t) => t.category === '日')?.total).toBe(100);
  });
});

describe('aggregateBySubcategory — discount-aware (effective_amount)', () => {
  it('drills into net subcategory amounts for a discounted tx', () => {
    const txs = [{
      amount: 900,
      tags: [],
      transaction_items: [
        { amount: 600, effective_amount: 540, tags: ['日:洗髮精'] },
        { amount: 400, effective_amount: 360, tags: ['日:牙膏'] },
      ],
    }];
    const result = aggregateBySubcategory(txs, '日');
    expect(result.find((t) => t.subcategory === '洗髮精')?.total).toBe(540);
    expect(result.find((t) => t.subcategory === '牙膏')?.total).toBe(360);
  });
});
