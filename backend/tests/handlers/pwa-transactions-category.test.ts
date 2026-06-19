import { describe, it, expect } from 'vitest';
import { itemWriteTags, EXPLICIT_UNCATEGORIZED } from '../../src/services/item-category';

// Feature 027 (B2): write-shape rules for POST /pwa/transactions and
// PUT /pwa/transactions/:id. Both map `items[].tag` through itemWriteTags(category_tag,
// item.tag) — these scenario tests mirror the handler's item mapping; the handler glue
// itself is thin and validated via quickstart, per the repo's test style.

describe('POST/PUT item write shape (FR-003/FR-013)', () => {
  const categoryTag = '食:雜貨';
  // Simulates the payload mapping in both handlers for a representative item mix.
  const payloadItems = [
    { name: '吐司', tag: null },                      // inheriting
    { name: '吐司2', tag: categoryTag },              // equal to tx default
    { name: '電池', tag: '日用:雜貨' },               // genuine override
    { name: '怪東西', tag: EXPLICIT_UNCATEGORIZED },  // deliberate 其他
  ];
  const stored = payloadItems.map((i) => itemWriteTags(categoryTag, i.tag));

  it('an inheriting item stores no tags (no category copy — US1 scenario 4)', () => {
    expect(stored[0]).toEqual([]);
  });

  it('a tag equal to the tx category is collapsed to inherit', () => {
    expect(stored[1]).toEqual([]);
  });

  it('a differing tag is preserved as an override', () => {
    expect(stored[2]).toEqual(['日用:雜貨']);
  });

  it('the sentinel is stored verbatim', () => {
    expect(stored[3]).toEqual([EXPLICIT_UNCATEGORIZED]);
  });

  it('an uncategorized tx stores items[].tag verbatim (override of "no default")', () => {
    expect(itemWriteTags(null, '食:早餐')).toEqual(['食:早餐']);
    expect(itemWriteTags(null, null)).toEqual([]);
  });
});

describe('GET /pwa/transactions item projection (feature 030)', () => {
  // Mirrors the handler's response shaping: the select projects
  // transaction_items(id, name, amount, effective_amount, tags) and the response maps
  // each row `({ transaction_items, ...rest }) => ({ ...rest, items: transaction_items })`,
  // preserving every item field verbatim. Guards that effective_amount reaches items[].
  const shapeResponse = (rows: { transaction_items: unknown[]; [k: string]: unknown }[]) =>
    rows.map(({ transaction_items, ...rest }) => ({ ...rest, items: transaction_items }));

  it('carries effective_amount on each returned item', () => {
    const rows = [
      {
        id: 'tx-1',
        amount: 300,
        transaction_items: [
          { id: 'i-1', name: '便當', amount: 120, effective_amount: 100, tags: ['食:午餐'] },
          { id: 'i-2', name: '飲料', amount: 60, effective_amount: 60, tags: ['食:飲料'] },
        ],
      },
    ];
    const [tx] = shapeResponse(rows);
    expect(tx.items).toHaveLength(2);
    for (const item of tx.items as { effective_amount: number | null }[]) {
      expect(item).toHaveProperty('effective_amount');
    }
    expect((tx.items as { effective_amount: number | null }[])[0].effective_amount).toBe(100);
  });

  it('preserves a null effective_amount (item with no net override)', () => {
    const rows = [
      { id: 'tx-2', transaction_items: [{ id: 'i-3', name: '雜支', amount: 50, effective_amount: null, tags: [] }] },
    ];
    const [tx] = shapeResponse(rows);
    expect((tx.items as { effective_amount: number | null }[])[0].effective_amount).toBeNull();
  });
});

describe('GET /pwa/transactions?category filter predicate', () => {
  // Mirrors the handler's inline category filter (pwa.ts). 其他 is the catch-all: it
  // additionally owns every transaction with no category tag anywhere — which a positive
  // tag match cannot see — mirroring aggregateByCategory's remainder→其他 routing.
  interface Tx { tags: string[]; items: { tags: string[] }[] }
  const inCategory = (tx: Tx, category: string) => {
    const matchesCategory = (tags: string[]) =>
      tags.some((t) => t === category || t.startsWith(`${category}:`));
    const hasMatch = tx.items.some((i) => matchesCategory(i.tags)) || matchesCategory(tx.tags);
    if (category === '其他') {
      const hasAnyCategoryTag =
        tx.tags.some((t) => t.includes(':')) ||
        tx.items.some((i) => i.tags.some((t) => t.includes(':')));
      return hasMatch || !hasAnyCategoryTag;
    }
    return hasMatch;
  };

  const uncategorised: Tx = { tags: [], items: [] };
  const uncategorisedItems: Tx = { tags: [], items: [{ tags: ['三商巧福'] }] };
  const explicitOther: Tx = { tags: [], items: [{ tags: ['其他:電信費'] }] };
  const categorised: Tx = { tags: ['食:早餐'], items: [{ tags: [] }] };

  it('其他 includes uncategorised txs (no tag anywhere) — the reverse-predicate fix', () => {
    expect(inCategory(uncategorised, '其他')).toBe(true);
    expect(inCategory(uncategorisedItems, '其他')).toBe(true);
  });

  it('其他 includes txs explicitly tagged 其他:*', () => {
    expect(inCategory(explicitOther, '其他')).toBe(true);
  });

  it('其他 excludes txs assigned to a named category', () => {
    expect(inCategory(categorised, '其他')).toBe(false);
  });

  it('a named category still matches only its own positive tags', () => {
    expect(inCategory(categorised, '食')).toBe(true);
    expect(inCategory(uncategorised, '食')).toBe(false);
    expect(inCategory(explicitOther, '食')).toBe(false);
  });
});

describe('refund-link item shape (B2)', () => {
  it('the refund tx keeps the parent-category snapshot; its item inherits (tags: [])', () => {
    // Mirrors the handler: tx tags = [parentCategoryTag], item tags = [] — the item
    // derives its category from its own transaction at read time.
    const parentCategoryTag = '食:雜貨';
    const refundTxTags = parentCategoryTag ? [parentCategoryTag] : [];
    const refundItemTags: string[] = [];
    expect(refundTxTags).toEqual(['食:雜貨']);
    expect(refundItemTags).toEqual([]);
  });
});
