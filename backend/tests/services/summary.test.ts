import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { periodToDateRange, aggregateByCategory, aggregateBySubcategory, formatCategoryTable } from '../../src/services/summary';

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
      { amount: 300, tags: ['食:午餐'] },
      { amount: 100, tags: ['食:晚餐'] },
      { amount: 200, tags: ['行:捷運'] },
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(2);
    expect(result.find((t) => t.category === '食')?.total).toBe(400);
    expect(result.find((t) => t.category === '行')?.total).toBe(200);
  });

  it('no tags → grouped under 其他', () => {
    const txs = [{ amount: 100, tags: [] }];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('其他');
    expect(result[0].total).toBe(100);
  });

  it('plain tag (no colon) → grouped under 其他', () => {
    const txs = [{ amount: 80, tags: ['三商巧福'] }];
    const result = aggregateByCategory(txs);
    expect(result[0].category).toBe('其他');
    expect(result[0].total).toBe(80);
  });

  it('sorted descending by total', () => {
    const txs = [
      { amount: 100, tags: ['A:x'] },
      { amount: 300, tags: ['B:x'] },
      { amount: 200, tags: ['C:x'] },
    ];
    const result = aggregateByCategory(txs);
    expect(result[0].total).toBe(300);
    expect(result[1].total).toBe(200);
    expect(result[2].total).toBe(100);
  });

  it('>5 named categories → caps at 5, merges overflow into 其他', () => {
    const txs = [
      { amount: 600, tags: ['A:x'] },
      { amount: 500, tags: ['B:x'] },
      { amount: 400, tags: ['C:x'] },
      { amount: 300, tags: ['D:x'] },
      { amount: 200, tags: ['E:x'] },
      { amount: 100, tags: ['F:x'] },
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(5);
    // Top 4 named: A, B, C, D; E+F merged into 其他
    const qita = result.find((t) => t.category === '其他');
    expect(qita?.total).toBe(300); // E(200) + F(100)
    expect(result.find((t) => t.category === 'A')?.total).toBe(600);
    expect(result.find((t) => t.category === 'D')?.total).toBe(300);
    expect(result.find((t) => t.category === 'E')).toBeUndefined();
    expect(result.find((t) => t.category === 'F')).toBeUndefined();
  });

  it('natural 其他 + >4 named → 其他 includes natural total + overflow', () => {
    const txs = [
      { amount: 600, tags: ['A:x'] },
      { amount: 500, tags: ['B:x'] },
      { amount: 400, tags: ['C:x'] },
      { amount: 300, tags: ['D:x'] },
      { amount: 200, tags: ['E:x'] },
      { amount: 100, tags: [] }, // natural 其他
    ];
    const result = aggregateByCategory(txs);
    expect(result).toHaveLength(5);
    const qita = result.find((t) => t.category === '其他');
    // natural 其他(100) + overflow E(200) = 300
    expect(qita?.total).toBe(300);
  });

  it('exactly 5 categories → returns all 5', () => {
    const txs = [
      { amount: 500, tags: ['A:x'] },
      { amount: 400, tags: ['B:x'] },
      { amount: 300, tags: ['C:x'] },
      { amount: 200, tags: ['D:x'] },
      { amount: 100, tags: ['E:x'] },
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
      { amount: 200, tags: ['食:午餐'] },
      { amount: 150, tags: ['食:晚餐'] },
      { amount: 100, tags: ['食:午餐'] },
    ];
    const result = aggregateBySubcategory(txs, '食');
    expect(result.find((t) => t.subcategory === '午餐')?.total).toBe(300);
    expect(result.find((t) => t.subcategory === '晚餐')?.total).toBe(150);
  });

  it('plain tag (no colon) → subcategory is 其他', () => {
    const txs = [{ amount: 80, tags: ['三商巧福'] }];
    const result = aggregateBySubcategory(txs, '其他');
    expect(result[0].subcategory).toBe('其他');
    expect(result[0].total).toBe(80);
  });

  it('multi-colon tag → subcategory is everything after first colon', () => {
    const txs = [{ amount: 300, tags: ['食:港式:飲茶'] }];
    const result = aggregateBySubcategory(txs, '食');
    expect(result[0].subcategory).toBe('港式:飲茶');
  });

  it('sorted descending by total', () => {
    const txs = [
      { amount: 100, tags: ['食:晚餐'] },
      { amount: 300, tags: ['食:午餐'] },
    ];
    const result = aggregateBySubcategory(txs, '食');
    expect(result[0].subcategory).toBe('午餐');
    expect(result[1].subcategory).toBe('晚餐');
  });
});

// ─── formatCategoryTable ──────────────────────────────────────────────────────

describe('formatCategoryTable', () => {
  it('produces markdown table with percentage and grand total', () => {
    const totals = [
      { category: '食', total: 300 },
      { category: '行', total: 200 },
      { category: '其他', total: 500 },
    ];
    const output = formatCategoryTable(totals);
    expect(output).toContain('| 分類 | 金額 | 占比 |');
    expect(output).toContain('NT$300');
    expect(output).toContain('NT$500');
    expect(output).toContain('💰 合計：NT$1,000');
  });

  it('percentages round to integer and sum approximately 100', () => {
    const totals = [
      { category: '食', total: 400 },
      { category: '行', total: 600 },
    ];
    const output = formatCategoryTable(totals);
    expect(output).toContain('40%');
    expect(output).toContain('60%');
  });
});
