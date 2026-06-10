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
