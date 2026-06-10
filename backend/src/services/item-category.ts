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
