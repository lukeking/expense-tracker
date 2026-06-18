// Feature 030: pure helpers for the Summary drilldown's second-level (subcategory)
// filter. Operate over the already-loaded major-category transaction list in memory
// (no new fetch). See specs/030-summary-subcategory-filter/data-model.md.

// The bar buckets bare-major tags (no `Major:Sub`) under the "Other" label, mirroring
// the backend's aggregateBySubcategory. A data sentinel that must match the backend
// value (not UI chrome) — allowlisted in check-i18n-coverage.sh, like EXPLICIT_UNCATEGORIZED.
const OTHER_SUBCATEGORY = '其他';

interface SubItem { tags: string[]; amount: number | null; effective_amount: number | null }
interface SubTx { transaction_type: string; tags: string[]; items: SubItem[] }

// Shared membership predicate over a tag list. Mirrors the server's major-level rule
// (`t === X || t.startsWith(X + ':')`) one level deeper; the "Other" branch matches the
// bare-major tag (the bucket the bar maps to Other).
function tagsMatchSub(tags: string[], major: string, sub: string): boolean {
  if (sub === OTHER_SUBCATEGORY) return tags.some((t) => t === major);
  return tags.some((t) => t === `${major}:${sub}` || t.startsWith(`${major}:${sub}:`));
}

// Does a single item belong to the selected subcategory (by its own tags)?
export function itemInSubcategory(item: SubItem, major: string, sub: string): boolean {
  return tagsMatchSub(item.tags, major, sub);
}

// Does a transaction belong to the selected subcategory? Considers tx-level tags plus
// all item tags — consistent with how the major-level drilldown list was selected.
export function txInSubcategory(tx: SubTx, major: string, sub: string): boolean {
  const tags = [...tx.tags, ...tx.items.flatMap((i) => i.tags)];
  return tagsMatchSub(tags, major, sub);
}

// The net amount this transaction contributes to the subcategory: the sum of its
// matching items' net per-item figure (`effective_amount`, discounts already applied;
// falls back to `amount`). Refunds negate. Exact for item-tagged spend and the "Other"
// bucket; transaction-level-only tags are the documented edge (research D3) and
// contribute 0 here.
export function subAmount(tx: SubTx, major: string, sub: string): number {
  const sign = tx.transaction_type === 'refund' ? -1 : 1;
  const net = tx.items
    .filter((i) => itemInSubcategory(i, major, sub))
    .reduce((s, i) => s + (i.effective_amount ?? i.amount ?? 0), 0);
  return sign * net;
}
