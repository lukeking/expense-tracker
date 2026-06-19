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

  it('itemless uncategorised tx → full amount under 其他:其他', () => {
    const txs = [{ amount: 100, tags: [], transaction_items: [] }];
    const result = aggregateBySubcategory(txs, '其他');
    expect(result).toEqual([{ subcategory: '其他', total: 100 }]);
  });

  it('categorised tx with inherited (untagged) items does NOT leak into 其他', () => {
    // B2: tx-level category is the source of truth; items inherit it untagged.
    const txs = [{ amount: 200, tags: ['食:早餐'], transaction_items: [{ amount: 200, tags: [] }] }];
    expect(aggregateBySubcategory(txs, '其他')).toEqual([]);
    expect(aggregateBySubcategory(txs, '食')).toEqual([{ subcategory: '早餐', total: 200 }]);
  });

  it('其他 subcategory totals reconcile with the major 其他 total', () => {
    const txs = [
      { amount: 100, tags: [], transaction_items: [] },                               // uncategorised, itemless → 其他
      { amount: 200, tags: ['食:早餐'], transaction_items: [{ amount: 200, tags: [] }] }, // categorised → 食, not 其他
      { amount: 80, tags: [], transaction_items: [{ amount: 80, tags: ['三商巧福'] }] },  // uncategorised plain tag → 其他
    ];
    const majorOther = aggregateByCategory(txs).find((c) => c.category === '其他')?.total;
    const subTotal = aggregateBySubcategory(txs, '其他').reduce((s, t) => s + t.total, 0);
    expect(majorOther).toBe(180);
    expect(subTotal).toBe(majorOther);
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

// ─── Feature 026: assigning a category moves item spend out of 其他 ────────────

describe('aggregateByCategory — item categorization (feature 026)', () => {
  // An invoice-filled item starts with tags:[] on a transaction whose only tag is a
  // plain store tag (全家); its spend lands in 其他. Assigning a category moves it.
  const txWith = (itemTags: string[]) => ({
    amount: 100,
    tags: ['全家'],
    transaction_items: [{ amount: 100, effective_amount: null, tags: itemTags }],
  });

  it('uncategorized invoice item → 其他', () => {
    expect(aggregateByCategory([txWith([])])).toEqual([{ category: '其他', total: 100 }]);
  });

  it('after assigning 飲食:零食 → counted under 飲食, not 其他', () => {
    const result = aggregateByCategory([txWith(['飲食:零食'])]);
    expect(result.find((t) => t.category === '飲食')?.total).toBe(100);
    expect(result.find((t) => t.category === '其他')).toBeUndefined();
  });

  it('grand total is unchanged by categorization (SC-005)', () => {
    const sum = (txs: Parameters<typeof aggregateByCategory>[0]) =>
      aggregateByCategory(txs).reduce((s, e) => s + e.total, 0);
    expect(sum([txWith(['飲食:零食'])])).toBe(sum([txWith([])]));
  });

  it('partial: one of two items categorized → remainder stays in 其他', () => {
    const tx = {
      amount: 100,
      tags: ['全家'],
      transaction_items: [
        { amount: 60, effective_amount: null, tags: ['飲食:零食'] },
        { amount: 40, effective_amount: null, tags: [] },
      ],
    };
    const result = aggregateByCategory([tx]);
    expect(result.find((t) => t.category === '飲食')?.total).toBe(60);
    expect(result.find((t) => t.category === '其他')?.total).toBe(40);
  });
});

// ─── Feature 026 (B1): itemless tx carries its category at tx-level ────────────

describe('aggregateByCategory — tx-level category for itemless transactions (B1)', () => {
  it('itemless tx with a tx-level category counts under that category, not 其他', () => {
    // Shape B1 writes: category first (tags[0]), plain tag after, no items.
    const tx = { amount: 120, tags: ['食:早餐', '愛滿滿早餐坊'], transaction_items: [] };
    const result = aggregateByCategory([tx]);
    expect(result.find((t) => t.category === '食')?.total).toBe(120);
    expect(result.find((t) => t.category === '其他')).toBeUndefined();
  });

  it('order-independent: category last in tags still resolves (read uses find)', () => {
    const tx = { amount: 120, tags: ['愛滿滿早餐坊', '食:早餐'], transaction_items: [] };
    expect(aggregateByCategory([tx]).find((t) => t.category === '食')?.total).toBe(120);
  });

  it('itemless tx with only a plain tag stays in 其他', () => {
    const tx = { amount: 120, tags: ['愛滿滿早餐坊'], transaction_items: [] };
    expect(aggregateByCategory([tx])).toEqual([{ category: '其他', total: 120 }]);
  });
});

// ─── Feature 027 (B2): old-shape ↔ normalized-shape equivalence ──────────────
// The aggregation is deliberately unchanged by B2 — these regressions pin down the
// property the whole feature rests on: an untagged item falls into the remainder,
// which buckets under the tx-level tag (live inheritance), and a tagged copy
// produces the exact same totals (mixed-era safety, FR-008/FR-012).

describe('aggregateByCategory — B2 shape equivalence (FR-008)', () => {
  const oldShape = {
    amount: 250,
    tags: ['食:雜貨', '全家'],
    transaction_items: [
      { amount: 200, tags: ['食:雜貨'] },        // write-time copy (pre-B2)
      { amount: 50, tags: ['樂:遊戲'] },          // genuine override
    ],
  };
  const normalized = {
    amount: 250,
    tags: ['食:雜貨', '全家'],
    transaction_items: [
      { amount: 200, tags: [] },                  // inherits at read time
      { amount: 50, tags: ['樂:遊戲'] },
    ],
  };

  it('copied shape and normalized shape produce identical category totals', () => {
    expect(aggregateByCategory([oldShape])).toEqual(aggregateByCategory([normalized]));
  });

  it('a mixed-era dataset aggregates each tx correctly (FR-012)', () => {
    const totals = aggregateByCategory([oldShape, normalized]);
    expect(totals).toEqual([
      { category: '食', total: 400 },
      { category: '樂', total: 100 },
    ]);
  });

  it('changing the tx category re-buckets inheriting items; overrides and the grand total hold (FR-007/SC-005)', () => {
    const before = aggregateByCategory([normalized]);
    const after = aggregateByCategory([{ ...normalized, tags: ['日用:雜貨', '全家'] }]);
    expect(before).toEqual([{ category: '食', total: 200 }, { category: '樂', total: 50 }]);
    expect(after).toEqual([{ category: '日用', total: 200 }, { category: '樂', total: 50 }]);
    const grand = (t: { total: number }[]) => t.reduce((s, e) => s + e.total, 0);
    expect(grand(after)).toBe(grand(before));
  });

  it('explicit-uncategorized sentinel buckets to 其他 despite the tx category', () => {
    const tx = {
      amount: 100,
      tags: ['食:雜貨'],
      transaction_items: [
        { amount: 60, tags: [] },                 // inherits 食
        { amount: 40, tags: ['其他:未分類'] },     // deliberate 其他
      ],
    };
    expect(aggregateByCategory([tx])).toEqual([
      { category: '食', total: 60 },
      { category: '其他', total: 40 },
    ]);
  });
});

describe('aggregateBySubcategory — sentinel drill-down (B2)', () => {
  it('the sentinel appears as 未分類 under 其他, distinct from the passive remainder', () => {
    const tx = {
      amount: 100,
      tags: [],
      transaction_items: [
        { amount: 40, tags: ['其他:未分類'] },  // deliberate 其他
        { amount: 60, tags: [] },               // passive (no decision anywhere)
      ],
    };
    expect(aggregateBySubcategory([tx], '其他')).toEqual([
      { subcategory: '其他', total: 60 },
      { subcategory: '未分類', total: 40 },
    ]);
  });
});
