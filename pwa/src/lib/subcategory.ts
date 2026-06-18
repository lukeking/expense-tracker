// Feature 030: pure helpers for the Summary drilldown's second-level (subcategory)
// filter. Operate over the already-loaded major-category transaction list in memory
// (no new fetch). See specs/030-summary-subcategory-filter/data-model.md.
//
// `subAmount` is a faithful port of the backend aggregateBySubcategory per-transaction
// logic (matched items + remainder/fallback), so the client list, day subtotals and
// header reconcile with the bar chart. This MUST mirror the backend because the app tags
// at the transaction level and items inherit that category (feature 027 B2) — most items
// carry no subcategory tag of their own, so a naive "sum items whose own tag matches"
// would read 0 for the common case.

// The bar buckets bare-major tags (no `Major:Sub`) under the "Other" label, mirroring
// the backend's aggregateBySubcategory. A data sentinel that must match the backend
// value (not UI chrome) — allowlisted in check-i18n-coverage.sh, like EXPLICIT_UNCATEGORIZED.
const OTHER_SUBCATEGORY = '其他';

interface SubItem { tags: string[]; amount: number | null; effective_amount: number | null }
interface SubTx { transaction_type: string; amount: number; tags: string[]; items: SubItem[] }

// The subcategory a `major`-tag maps to: a bare major → Other; otherwise the part after
// the major (`Food:Lunch` → Lunch, a trailing `Food:` → Other).
function subOf(tag: string, major: string): string {
  if (tag === major) return OTHER_SUBCATEGORY;
  return tag.split(':').slice(1).join(':') || OTHER_SUBCATEGORY;
}

// The first tag belonging to `major` (bare `major` or `major:...`), or null.
function majorTag(tags: string[], major: string): string | null {
  return tags.find((t) => t === major || t.startsWith(`${major}:`)) ?? null;
}

// Which subcategory of `major` an item belongs to — its own category tag if it has one,
// otherwise inherited from the transaction (feature 027 B2). null if not in `major`.
// Used to decide which item lines to show (and break down) under an active filter.
export function itemSubcategory(item: SubItem, tx: SubTx, major: string): string | null {
  const own = majorTag(item.tags, major);
  if (own) return subOf(own, major);
  const inherited = majorTag(tx.tags, major);
  if (inherited) return subOf(inherited, major);
  // Drilling into the top-level Other major: plain-tag items bucket into Other.
  if (major === OTHER_SUBCATEGORY && !item.tags.some((t) => t.includes(':'))) return OTHER_SUBCATEGORY;
  return null;
}

// Does an item (with its tx for inheritance) effectively belong to the selected subcategory?
export function itemInSubcategory(item: SubItem, tx: SubTx, major: string, sub: string): boolean {
  return itemSubcategory(item, tx, major) === sub;
}

// The net amount this transaction contributes to the subcategory. Matched items (own
// `major:` tag) contribute their net `effective_amount`; the remainder (tx.amount − the
// matched items) follows the transaction's own category tag — covering inherited,
// untagged, and itemless transactions exactly as the backend bar does. Refunds negate.
export function subAmount(tx: SubTx, major: string, sub: string): number {
  const sign = tx.transaction_type === 'refund' ? -1 : 1;
  const prefix = `${major}:`;
  let matchedSum = 0;
  let contrib = 0;
  for (const item of tx.items) {
    const eff = item.effective_amount ?? item.amount;
    if (eff == null) continue;
    const ownTag = item.tags.find((t) => t.startsWith(prefix)) ?? null;
    if (!ownTag) {
      // Drilling into Other: plain-tag items bucket into Other and count as matched.
      if (major === OTHER_SUBCATEGORY && !item.tags.some((t) => t.includes(':'))) {
        matchedSum += eff;
        if (sub === OTHER_SUBCATEGORY) contrib += eff;
      }
      continue;
    }
    matchedSum += eff;
    if (subOf(ownTag, major) === sub) contrib += eff;
  }
  const remainder = tx.amount - matchedSum;
  if (remainder > 0) {
    const fallbackTag =
      tx.tags.find((t) => t.startsWith(prefix)) ??
      tx.items.flatMap((i) => i.tags).find((t) => t.startsWith(prefix)) ??
      null;
    if (fallbackTag) {
      if (subOf(fallbackTag, major) === sub) contrib += remainder;
    } else {
      const anyMatch =
        tx.tags.find((t) => t.split(':')[0] === major) ??
        tx.items.flatMap((i) => i.tags).find((t) => t.split(':')[0] === major) ??
        null;
      if (anyMatch && sub === OTHER_SUBCATEGORY) contrib += remainder;
    }
  }
  return sign * contrib;
}

// A transaction belongs to the subcategory's day-grouped list iff it has a non-zero net
// contribution there — which also keeps the list and the amounts consistent (no NT$0 rows).
export function txInSubcategory(tx: SubTx, major: string, sub: string): boolean {
  return subAmount(tx, major, sub) !== 0;
}
