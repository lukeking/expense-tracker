import { describe, it, expect } from 'vitest';
import { mergeItemCategoryTag, EXPLICIT_UNCATEGORIZED } from '../../src/services/item-category';

// Logic-level tests for PATCH /pwa/transactions/:id/items/:itemId. The tag-merge rule
// is the substantive new logic; the handler glue (404/403, audit-history insert) is
// thin and validated via quickstart, mirroring the repo's unit-test style.

describe('mergeItemCategoryTag — assign / reassign / clear', () => {
  it('assigns a category to an item with no tags (invoice-filled case)', () => {
    expect(mergeItemCategoryTag([], '飲食:零食')).toEqual(['飲食:零食']);
  });

  it('appends the category while preserving an existing plain tag (全家)', () => {
    expect(mergeItemCategoryTag(['全家'], '飲食:零食')).toEqual(['全家', '飲食:零食']);
  });

  it('replaces the single category tag in place (reassign), keeping plain tags & order', () => {
    expect(mergeItemCategoryTag(['全家', '飲食:零食'], '居家:衛生用品')).toEqual(['全家', '居家:衛生用品']);
  });

  it('clears the category (null) but keeps plain tags', () => {
    expect(mergeItemCategoryTag(['全家', '飲食:零食'], null)).toEqual(['全家']);
  });

  it('clear on an already-uncategorized item is a no-op', () => {
    expect(mergeItemCategoryTag(['全家'], null)).toEqual(['全家']);
    expect(mergeItemCategoryTag([], null)).toEqual([]);
  });

  it('re-assigning the same category is idempotent (deep-equal input → no audit row)', () => {
    const before = ['全家', '飲食:零食'];
    const after = mergeItemCategoryTag(before, '飲食:零食');
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)); // handler skips write/history when equal
  });

  it('keeps at most one category tag (invariant 1)', () => {
    const out = mergeItemCategoryTag(['a:b'], 'c:d');
    expect(out.filter((t) => t.includes(':'))).toHaveLength(1);
    expect(out).toEqual(['c:d']);
  });
});

describe('category_tag validation rule (handler guard)', () => {
  // Mirrors the handler's INVALID_CATEGORY_TAG guard.
  const isValid = (v: unknown) => v === null || (typeof v === 'string' && v.trim() !== '');
  it('accepts a non-empty string or null', () => {
    expect(isValid('飲食:零食')).toBe(true);
    expect(isValid(null)).toBe(true);
  });
  it('rejects empty / whitespace / non-string', () => {
    expect(isValid('')).toBe(false);
    expect(isValid('   ')).toBe(false);
    expect(isValid(42)).toBe(false);
  });
});

// Feature 027 (B2): PATCH semantics extension — collapse-to-inherit and the
// explicit-uncategorized sentinel (contracts/internal-api.md).
describe('PATCH collapse + sentinel (B2)', () => {
  // Mirrors the handler: a tag equal to the tx's current category is treated as null.
  const effectiveAssign = (txTags: string[], categoryTag: string | null) => {
    const txCategoryTag = txTags.find((t) => t.includes(':')) ?? null;
    return categoryTag !== null && categoryTag === txCategoryTag ? null : categoryTag;
  };

  it('assigning the tx own category collapses to inherit (stores nothing)', () => {
    const assign = effectiveAssign(['食:雜貨', '全家'], '食:雜貨');
    expect(assign).toBeNull();
    expect(mergeItemCategoryTag(['全家', '樂:遊戲'], assign)).toEqual(['全家']);
  });

  it('assigning the sentinel stores it verbatim', () => {
    const assign = effectiveAssign(['食:雜貨'], EXPLICIT_UNCATEGORIZED);
    expect(assign).toBe(EXPLICIT_UNCATEGORIZED);
    expect(mergeItemCategoryTag(['全家'], assign)).toEqual(['全家', EXPLICIT_UNCATEGORIZED]);
  });

  it('inherit (null) clears an override and a sentinel alike', () => {
    expect(mergeItemCategoryTag(['樂:遊戲'], null)).toEqual([]);
    expect(mergeItemCategoryTag([EXPLICIT_UNCATEGORIZED], null)).toEqual([]);
  });

  it('idempotent sentinel re-assign produces deep-equal tags (no history row)', () => {
    const before = ['全家', EXPLICIT_UNCATEGORIZED];
    const after = mergeItemCategoryTag(before, effectiveAssign(['食:雜貨'], EXPLICIT_UNCATEGORIZED));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });

  it('collapse on an already-inheriting item is a no-op (no history row)', () => {
    const before = ['全家'];
    const after = mergeItemCategoryTag(before, effectiveAssign(['食:雜貨'], '食:雜貨'));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});
