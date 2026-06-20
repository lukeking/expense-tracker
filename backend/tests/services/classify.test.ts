import { describe, it, expect } from 'vitest';
import { classify, categoryTotal, aggregateBySubcategory, UNCATEGORIZED } from '../../src/services/summary';
import { EXPLICIT_UNCATEGORIZED } from '../../src/services/item-category';

// Feature 031: `classify` is the single source of truth for how a transaction's money
// splits across categories. These cases follow the enumeration in the design notes —
// the `#N` labels map to the combination table. 未分類 = no decision; 其他 = real misc.

interface Item { amount: number | null; effective_amount?: number | null; tags: string[] }
const tx = (amount: number, tags: string[], items: Item[] = [], type = 'expense') => ({
  amount,
  transaction_type: type,
  tags,
  transaction_items: items,
});
const sum = (txs: ReturnType<typeof tx>[], major: string) => categoryTotal(txs, major);

describe('classify — untagged tx (the 未分類 sources)', () => {
  it('#1 itemless untagged tx → whole amount is 未分類 (the auto-capture case)', () => {
    expect(classify(tx(100, [], []))).toEqual([
      { major: UNCATEGORIZED, sub: UNCATEGORIZED, amount: 100, itemIndex: null },
    ]);
  });

  it('#2 untagged tx, items inherit (no own tag) → all 未分類', () => {
    const t = tx(100, [], [{ amount: 60, tags: [] }, { amount: 40, tags: [] }]);
    expect(sum([t], UNCATEGORIZED)).toBe(100);
  });

  it('#5 untagged tx, own-tagged items under-cover → items to their cats, gap to 未分類', () => {
    const t = tx(100, [], [{ amount: 70, tags: ['食:午餐'] }]);
    expect(sum([t], '食')).toBe(70);
    expect(sum([t], UNCATEGORIZED)).toBe(30);
  });

  it('#6 amount-less tagged item is decorative → whole amount still 未分類', () => {
    const t = tx(100, [], [{ amount: null, tags: ['食:午餐'] }]);
    expect(sum([t], '食')).toBe(0);
    expect(sum([t], UNCATEGORIZED)).toBe(100);
  });

  it('#7 untagged tx + sentinel item → both sentinel and remainder are 未分類', () => {
    const t = tx(100, [], [{ amount: 40, tags: [EXPLICIT_UNCATEGORIZED] }]);
    expect(sum([t], UNCATEGORIZED)).toBe(100);
    expect(sum([t], '其他')).toBe(0);
  });
});

describe('classify — tagged tx never leaks into 未分類/其他', () => {
  it('#12 tagged tx, override items under-cover → gap follows the tx category (not 未分類)', () => {
    const t = tx(100, ['食:晚餐'], [{ amount: 30, tags: ['行:捷運'] }]);
    expect(sum([t], '行')).toBe(30);
    expect(sum([t], '食')).toBe(70); // the 70 remainder inherits 食, NOT 未分類
    expect(sum([t], UNCATEGORIZED)).toBe(0);
  });

  it('#13 tagged tx + sentinel item → sentinel is 未分類, remainder stays in the tx category', () => {
    const t = tx(100, ['食:晚餐'], [{ amount: 40, tags: [EXPLICIT_UNCATEGORIZED] }]);
    expect(sum([t], UNCATEGORIZED)).toBe(40);
    expect(sum([t], '食')).toBe(60);
    expect(sum([t], '其他')).toBe(0);
  });

  it('#14 tagged tx + explicit 其他:X item → that item is real 其他, not 未分類', () => {
    const t = tx(100, ['食:晚餐'], [{ amount: 25, tags: ['其他:雜支'] }]);
    expect(sum([t], '其他')).toBe(25);
    expect(sum([t], '食')).toBe(75);
    expect(sum([t], UNCATEGORIZED)).toBe(0);
  });
});

describe('reconciliation + invariants', () => {
  it('separates passive 未分類 from deliberate 其他 (the bug fixture: was both 其他)', () => {
    const txs = [tx(100, [], []), tx(50, ['其他:其他'], [])];
    expect(sum(txs, UNCATEGORIZED)).toBe(100);
    expect(sum(txs, '其他')).toBe(50);
  });

  it('every dollar lands in exactly one major → Σ majors == signed grand total', () => {
    const txs = [
      tx(100, [], []),
      tx(50, ['其他:其他'], []),
      tx(100, ['食:晚餐'], [{ amount: 40, tags: [EXPLICIT_UNCATEGORIZED] }]),
      tx(30, [], [], 'refund'),
    ];
    const grand = txs.reduce((s, t) => s + (t.transaction_type === 'refund' ? -t.amount : t.amount), 0);
    const majors = new Set(txs.flatMap((t) => classify(t).map((c) => c.major)));
    const byMajor = [...majors].reduce((s, m) => s + categoryTotal(txs, m), 0);
    expect(byMajor).toBe(grand);
  });

  it('refunds negate within 未分類', () => {
    expect(sum([tx(30, [], [], 'refund')], UNCATEGORIZED)).toBe(-30);
  });

  // The exact property the /summary/subcategories handler now relies on: its header
  // `categoryTotal(txs, major)` equals Σ of its `aggregateBySubcategory(txs, major)` bars.
  // This is the bug that the throwaway demo exposed (header 50 vs bars 150).
  it('categoryTotal(major) == Σ aggregateBySubcategory(major) for every major', () => {
    const txs = [
      tx(100, [], []),                                                      // 未分類 100
      tx(50, ['其他:其他'], []),                                             // 其他 50
      tx(200, ['食:晚餐'], [{ amount: 80, tags: ['行:捷運'] }]),            // 行 80, 食 120
      tx(40, [], [{ amount: 40, tags: ['食:午餐'] }]),                      // 食 40
      tx(30, [], [], 'refund'),                                            // 未分類 -30
    ];
    for (const major of ['未分類', '其他', '食', '行']) {
      const bars = aggregateBySubcategory(txs, major).reduce((s, b) => s + b.total, 0);
      expect(categoryTotal(txs, major)).toBe(bars);
    }
  });
});
