// Feature 026 (FR-007): shared predicate + accessor for an item's category.

const hasCategory = (tags: string[]) => tags.some((t) => t.includes(':'));

// An item is "uncategorized" when it has no category (`:`-)tag AND its transaction
// has no category tag for it to inherit. Drives the ⚠ 未分類 flag on both surfaces.
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
