import type { SummaryPeriod, CategoryTotal, SubcategoryTotal } from '../types';
import { EXPLICIT_UNCATEGORIZED } from './item-category';

interface TxForSummary {
  amount: number;
  transaction_type?: string;
  tags: string[];
  transaction_items: { amount: number | null; effective_amount?: number | null; tags: string[] }[];
}

// The two synthetic (non-catalog) buckets. 未分類 = no category decision anywhere
// (passive untagged remainder, or the deliberate sentinel); 其他 = a real
// "miscellaneous" category the user actively picks (其他:其他 / 其他:子類).
export const UNCATEGORIZED = '未分類';
const OTHER = '其他';

export interface CategoryContribution {
  major: string;
  sub: string;
  amount: number; // signed (refund negated)
  itemIndex: number | null; // null = the transaction-level remainder, not an item line
}

// (major, sub) for a `:`-category tag. A bare `Major:` (no sub) buckets under 其他;
// the explicit-uncategorized sentinel resolves to 未分類 (decision: it IS "no category").
function tagBuckets(tag: string): { major: string; sub: string } {
  if (tag === EXPLICIT_UNCATEGORIZED) return { major: UNCATEGORIZED, sub: UNCATEGORIZED };
  return { major: tag.split(':')[0], sub: tag.split(':').slice(1).join(':') || OTHER };
}

// THE single source of truth for how a transaction's money splits across categories.
// Every Summary slice (category bar, subcategory bar, header total, transaction-list
// category filter) derives from this, so they reconcile by construction. Only items that
// carry their OWN `:`-tag contribute directly (an over-tagged item's amount is trusted as
// given); items with no own tag inherit the tx category via the leftover `remainder`,
// which follows the tx's tag — or 未分類 when the tx itself is uncategorized. The split
// from the legacy logic is exactly that last fallback (was 其他).
export function classify(tx: TxForSummary): CategoryContribution[] {
  const sign = tx.transaction_type === 'refund' ? -1 : 1;
  const items = tx.transaction_items ?? [];
  const txTag = tx.tags.find((t) => t.includes(':')) ?? null;
  const out: CategoryContribution[] = [];
  let covered = 0;
  items.forEach((item, idx) => {
    const eff = item.effective_amount ?? item.amount;
    if (eff == null) return; // amount-less item: decorative, never moves money
    const ownTag = item.tags.find((t) => t.includes(':')) ?? null;
    if (!ownTag) return; // no own category → inherits via the remainder below
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

// A major's total = the sum of its contributions = the sum of its subcategory bars, so
// the drilldown header and bars can never disagree (the bug this replaces).
export function categoryTotal(transactions: TxForSummary[], major: string): number {
  let total = 0;
  for (const tx of transactions) {
    for (const c of classify(tx)) {
      if (c.major === major) total += c.amount;
    }
  }
  return total;
}

export function periodToDateRange(period: SummaryPeriod): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case 'month': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { start, end: now };
    }
    case 'last-month': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { start, end };
    }
    case '3months': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, now.getUTCDate()));
      return { start, end: now };
    }
    case 'half-year': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 6, now.getUTCDate()));
      return { start, end: now };
    }
    case 'year': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, now.getUTCDate()));
      return { start, end: now };
    }
    case 'all': {
      return { start: new Date(0), end: now };
    }
  }
}

export function aggregateByCategory(
  transactions: TxForSummary[]
): CategoryTotal[] {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    for (const c of classify(tx)) {
      map.set(c.major, (map.get(c.major) ?? 0) + c.amount);
    }
  }

  // Return every category (no overflow merge) so the PWA can show and drill into all
  // of them. The Discord embed applies `mergeOverflowCategories` itself for its tighter
  // field budget; the two surfaces intentionally differ.
  return Array.from(map.entries())
    .filter(([, total]) => total > 0)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

// Caps to top-4 named + overflow-into-其他. Used by the Discord summary embed.
export function mergeOverflowCategories(
  rawTotals: { category: string; total: number }[]
): CategoryTotal[] {
  const sorted = [...rawTotals].sort((a, b) => b.total - a.total);
  if (sorted.length <= 5) return sorted;

  const named = sorted.filter((e) => e.category !== '其他');
  const natural = sorted.find((e) => e.category === '其他');
  const top4Named = named.slice(0, 4);
  const overflowNamed = named.slice(4);
  const qiTaTotal =
    (natural?.total ?? 0) + overflowNamed.reduce((s, e) => s + e.total, 0);

  const result: CategoryTotal[] = [...top4Named];
  if (qiTaTotal > 0) result.push({ category: '其他', total: qiTaTotal });
  return result.sort((a, b) => b.total - a.total);
}

export function aggregateBySubcategory(
  transactions: TxForSummary[],
  category: string
): SubcategoryTotal[] {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    for (const c of classify(tx)) {
      if (c.major !== category) continue;
      map.set(c.sub, (map.get(c.sub) ?? 0) + c.amount);
    }
  }
  return Array.from(map.entries())
    .map(([subcategory, total]) => ({ subcategory, total }))
    .sort((a, b) => b.total - a.total);
}

export function buildCategoryEmbedFields(
  totals: CategoryTotal[]
): { name: string; value: string; inline: boolean }[] {
  const grandTotal = totals.reduce((s, t) => s + t.total, 0);
  return totals.map((t) => {
    const pct = grandTotal > 0 ? Math.round((t.total / grandTotal) * 100) : 0;
    return { name: t.category, value: `NT$${t.total.toLocaleString()} (${pct}%)`, inline: true };
  });
}

const MAX_SUBCATEGORY_FIELDS = 25;

export function buildSubcategoryEmbedFields(
  subtotals: SubcategoryTotal[]
): { name: string; value: string; inline: boolean }[] {
  const sorted = [...subtotals].sort((a, b) => b.total - a.total);

  if (sorted.length <= MAX_SUBCATEGORY_FIELDS) {
    return sorted.map((t) => ({
      name: t.subcategory,
      value: `NT$${t.total.toLocaleString()}`,
      inline: true,
    }));
  }

  const top = sorted.slice(0, MAX_SUBCATEGORY_FIELDS - 1);
  const rest = sorted.slice(MAX_SUBCATEGORY_FIELDS - 1);
  const restTotal = rest.reduce((s, t) => s + t.total, 0);

  return [
    ...top.map((t) => ({ name: t.subcategory, value: `NT$${t.total.toLocaleString()}`, inline: true })),
    { name: `其他 (${rest.length} 項)`, value: `NT$${restTotal.toLocaleString()}`, inline: true },
  ];
}
