// Feature 030/031: pure helpers for the Summary drilldown's subcategory filter. A faithful
// port of the backend `classify` (services/summary.ts) so the client list, day subtotals and
// header reconcile with the bars. The app tags at the transaction level and items inherit
// that category (feature 027 B2) — most items carry no subcategory tag of their own, so a
// naive "sum items whose own tag matches" would read 0 for the common case.

import { EXPLICIT_UNCATEGORIZED } from './itemCategory';

// The two synthetic buckets — data sentinels that must match the backend's labels (not UI
// chrome; allowlisted in check-i18n-coverage.sh). UNCATEGORIZED = no category decision
// anywhere (passive remainder, or the sentinel); OTHER = a bare major / a real Other category.
export const UNCATEGORIZED = '未分類';
const OTHER_SUBCATEGORY = '其他';

interface SubItem { tags: string[]; amount: number | null; effective_amount: number | null }
interface SubTx { transaction_type: string; amount: number; tags: string[]; items: SubItem[] }

// (major, sub) for a `:`-category tag — mirrors backend tagBuckets. A bare `Major:` (no sub)
// buckets under OTHER; the explicit-uncategorized sentinel resolves to UNCATEGORIZED.
function tagBuckets(tag: string): { major: string; sub: string } {
  if (tag === EXPLICIT_UNCATEGORIZED) return { major: UNCATEGORIZED, sub: UNCATEGORIZED };
  return { major: tag.split(':')[0], sub: tag.split(':').slice(1).join(':') || OTHER_SUBCATEGORY };
}

interface Contribution { major: string; sub: string; amount: number; itemIndex: number | null }

// The single source of truth, mirroring backend classify(): only own-tagged items contribute
// directly; items with no own tag inherit the tx category via the remainder, which follows the
// tx's tag — or UNCATEGORIZED when the tx itself is uncategorized. Refunds negate.
function classify(tx: SubTx): Contribution[] {
  const sign = tx.transaction_type === 'refund' ? -1 : 1;
  const txTag = tx.tags.find((t) => t.includes(':')) ?? null;
  const out: Contribution[] = [];
  let covered = 0;
  tx.items.forEach((item, idx) => {
    const eff = item.effective_amount ?? item.amount;
    if (eff == null) return;
    const ownTag = item.tags.find((t) => t.includes(':')) ?? null;
    if (!ownTag) return;
    covered += eff;
    const { major, sub } = tagBuckets(ownTag);
    out.push({ major, sub, amount: sign * eff, itemIndex: idx });
  });
  const remainder = tx.amount - covered;
  if (remainder > 0) {
    const { major, sub } = txTag ? tagBuckets(txTag) : { major: UNCATEGORIZED, sub: UNCATEGORIZED };
    out.push({ major, sub, amount: sign * remainder, itemIndex: null });
  }
  return out;
}

// Which subcategory of `major` an item LINE belongs to (for display): own tag → inherited tx
// tag → passive UNCATEGORIZED. null if not in `major`. This is line membership; the money is in
// `subAmount`, where inherited items flow through the remainder.
export function itemSubcategory(item: SubItem, tx: SubTx, major: string): string | null {
  const own = item.tags.find((t) => t.includes(':')) ?? null;
  if (own) { const b = tagBuckets(own); return b.major === major ? b.sub : null; }
  const txTag = tx.tags.find((t) => t.includes(':')) ?? null;
  if (txTag) { const b = tagBuckets(txTag); return b.major === major ? b.sub : null; }
  return major === UNCATEGORIZED ? UNCATEGORIZED : null;
}

// Does an item (with its tx for inheritance) effectively belong to the selected subcategory?
export function itemInSubcategory(item: SubItem, tx: SubTx, major: string, sub: string): boolean {
  return itemSubcategory(item, tx, major) === sub;
}

// The net amount this transaction contributes to (major, sub) — the sum of its classify
// contributions there. Already refund-signed.
export function subAmount(tx: SubTx, major: string, sub: string): number {
  let total = 0;
  for (const c of classify(tx)) {
    if (c.major === major && c.sub === sub) total += c.amount;
  }
  return total;
}

// A transaction belongs to the subcategory's day-grouped list iff it has a non-zero net
// contribution there — which keeps the list and the amounts consistent (no NT$0 rows).
export function txInSubcategory(tx: SubTx, major: string, sub: string): boolean {
  return subAmount(tx, major, sub) !== 0;
}

interface MajorTx { tags: string[]; items: { tags: string[] }[] }

// Whether a transaction belongs to `major` — mirrors the backend /pwa/transactions
// classify-based filter (UNCATEGORIZED and OTHER are ordinary majors, no reverse predicate). A
// tag-level membership check (no amounts needed): the remainder follows the tx tag, or
// UNCATEGORIZED when untagged; own-tagged items add their own major. Used to scope the filter-bar
// chip pools to the drilled-into major.
export function txInMajor(tx: MajorTx, major: string): boolean {
  const txTag = tx.tags.find((t) => t.includes(':')) ?? null;
  const remainderMajor = txTag ? tagBuckets(txTag).major : UNCATEGORIZED;
  if (remainderMajor === major) return true;
  return tx.items.some((i) => {
    const own = i.tags.find((t) => t.includes(':')) ?? null;
    return own ? tagBuckets(own).major === major : false;
  });
}
