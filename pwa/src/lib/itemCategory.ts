// Feature 026 (FR-007): shared predicate + accessor for an item's category.
// Feature 027 (B2): tx-level category is the single source; an item's `:`-tag exists
// only as a deliberate override, or as the explicit-uncategorized sentinel below.

// Mirrors EXPLICIT_UNCATEGORIZED in backend/src/services/item-category.ts — a real
// `:`-tag (untagged items inherit), bucketing to 其他. Never shown as a picker chip.
export const EXPLICIT_UNCATEGORIZED = '其他:未分類';

const hasCategory = (tags: string[]) => tags.some((t) => t.includes(':'));

// An item is "uncategorized" when no category decision exists anywhere: no item
// `:`-tag AND no tx category to inherit. The sentinel counts as categorized (it IS
// a decision), so it never raises the ⚠ 未分類 flag.
export function isItemUncategorized(
  item: { tags: string[] },
  tx: { tags: string[] }
): boolean {
  return !hasCategory(item.tags) && !hasCategory(tx.tags);
}

// The item's own category tag (first `:`-containing tag), or null.
export function itemCategoryTag(item: { tags: string[] }): string | null {
  return item.tags.find((t) => t.includes(':')) ?? null;
}

export type EffectiveCategorySource = 'override' | 'explicit-uncategorized' | 'inherited' | 'none';

// Read-time derivation (data-model.md): own override → sentinel → inherited → none.
// Must agree with the backend aggregation's implicit rule (item tag, else remainder
// buckets under the tx tag, else 其他).
export function effectiveItemCategory(
  item: { tags: string[] },
  tx: { tags: string[] }
): { tag: string | null; source: EffectiveCategorySource } {
  const own = itemCategoryTag(item);
  if (own === EXPLICIT_UNCATEGORIZED) return { tag: '其他', source: 'explicit-uncategorized' };
  if (own !== null) return { tag: own, source: 'override' };
  const inherited = tx.tags.find((t) => t.includes(':')) ?? null;
  if (inherited !== null) return { tag: inherited, source: 'inherited' };
  return { tag: null, source: 'none' };
}
