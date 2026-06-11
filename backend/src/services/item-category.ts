// Feature 026: pure tag-merge rule for assigning / reassigning / clearing a single
// transaction item's category. Plain (non-`:`) tags are preserved; the single
// category tag is replaced in place so re-assigning the same value is idempotent
// (returns an array deep-equal to the input). Passing `null` clears the category.
export function mergeItemCategoryTag(currentTags: string[], categoryTag: string | null): string[] {
  if (categoryTag === null) return currentTags.filter((t) => !t.includes(':'));
  if (currentTags.some((t) => t.includes(':'))) {
    return currentTags.map((t) => (t.includes(':') ? categoryTag : t));
  }
  return [...currentTags, categoryTag];
}

// Feature 027 (B2): the transaction-level category is the single source of truth;
// an item stores a `:`-tag only as a deliberate override. The sentinel below marks
// "explicitly uncategorized" (deliberately 其他 despite the tx default) — it must be
// a real `:`-tag because an untagged item *inherits* via the summary's remainder
// logic. Item-only; never valid at tx level; never added to the categories catalog.
export const EXPLICIT_UNCATEGORIZED = '其他:未分類';

// Collapse rule (FR-013): an item tag equal to the transaction's category is
// redundant (inheritance is live at read time) and is never stored. Plain tags and
// the sentinel pass through untouched (the sentinel never equals a tx category).
export function normalizeItemTagsOnWrite(txCategoryTag: string | null, itemTags: string[]): string[] {
  if (txCategoryTag === null) return itemTags;
  return itemTags.filter((t) => t !== txCategoryTag);
}

// Single-tag convenience for the PWA POST/PUT item shape (`items[].tag`); null = inherit.
export function itemWriteTags(txCategoryTag: string | null, itemTag: string | null): string[] {
  return itemTag != null ? normalizeItemTagsOnWrite(txCategoryTag, [itemTag]) : [];
}

// Unanimous promotion (FR-003/FR-009): a category-less transaction whose items all
// carry the same catalog category gets it promoted to tx level (prepended, per the
// legacy tags[0] write convention) and the items collapse to inheritance. The
// sentinel is never promoted (tx-level "uncategorized" = absence of a `:`-tag).
export function promoteUnanimousCategory(
  txTags: string[],
  itemTagsList: string[][]
): { txTags: string[]; itemTagsList: string[][]; promoted: string | null } {
  const noop = { txTags, itemTagsList, promoted: null };
  if (itemTagsList.length === 0 || txTags.some((t) => t.includes(':'))) return noop;
  const cats = itemTagsList.map((tags) => tags.find((t) => t.includes(':')) ?? null);
  const first = cats[0];
  if (first === null || first === EXPLICIT_UNCATEGORIZED) return noop;
  if (!cats.every((c) => c === first)) return noop;
  return {
    txTags: [first, ...txTags],
    itemTagsList: itemTagsList.map((tags) => tags.filter((t) => t !== first)),
    promoted: first,
  };
}

// One-off migration transform (data-model.md): returns the proposed normalized tag
// shapes, or null when the transaction is already normalized. The caller (the
// normalize-category-ssot script) is responsible for the total-preserving guard
// (aggregate before/after comparison) and for persisting.
export function planTransactionNormalization(tx: {
  tags: string[];
  items: { tags: string[] }[];
}): { txTags: string[]; itemTags: string[][] } | null {
  const txCat = tx.tags.find((t) => t.includes(':')) ?? null;
  if (txCat !== null) {
    const itemTags = tx.items.map((i) => normalizeItemTagsOnWrite(txCat, i.tags));
    const changed = itemTags.some((tags, i) => tags.length !== tx.items[i].tags.length);
    return changed ? { txTags: tx.tags, itemTags } : null;
  }
  const { txTags, itemTagsList, promoted } = promoteUnanimousCategory(
    tx.tags,
    tx.items.map((i) => i.tags)
  );
  return promoted !== null ? { txTags, itemTags: itemTagsList } : null;
}
