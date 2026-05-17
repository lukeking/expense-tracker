import type { SummaryPeriod, CategoryTotal, SubcategoryTotal, TransactionItemRow } from '../types';

type TxForSummary = {
  amount: number;
  tags: string[];
  transaction_items: Pick<TransactionItemRow, 'amount' | 'tags'>[];
};

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
    const items = tx.transaction_items ?? [];
    let categorisedSum = 0;
    for (const item of items) {
      if (item.amount == null) continue;
      const categoryTag = item.tags.find((t) => t.includes(':')) ?? null;
      if (!categoryTag) continue;
      const category = categoryTag.split(':')[0];
      map.set(category, (map.get(category) ?? 0) + item.amount);
      categorisedSum += item.amount;
    }
    const remainder = tx.amount - categorisedSum;
    if (remainder > 0) {
      map.set('其他', (map.get('其他') ?? 0) + remainder);
    }
  }

  const sorted = Array.from(map.entries())
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);

  if (sorted.length <= 5) return sorted;

  // More than 5 distinct categories: keep top 4 named (non-其他), merge rest into 其他
  const named = sorted.filter((e) => e.category !== '其他');
  const natural = sorted.find((e) => e.category === '其他');

  const top4Named = named.slice(0, 4);
  const overflowNamed = named.slice(4);

  const qiTaTotal =
    (natural?.total ?? 0) + overflowNamed.reduce((s, e) => s + e.total, 0);

  const result: CategoryTotal[] = [...top4Named];
  if (qiTaTotal > 0) {
    result.push({ category: '其他', total: qiTaTotal });
  }

  return result.sort((a, b) => b.total - a.total);
}

export function aggregateBySubcategory(
  transactions: TxForSummary[],
  category: string
): SubcategoryTotal[] {
  const map = new Map<string, number>();
  const prefix = category + ':';
  for (const tx of transactions) {
    const items = tx.transaction_items ?? [];
    let matchedSum = 0;
    for (const item of items) {
      if (item.amount == null) continue;
      const categoryTag = item.tags.find((t) => t.startsWith(prefix)) ?? null;
      if (!categoryTag) continue;
      const subcategory = categoryTag.split(':').slice(1).join(':') || '其他';
      map.set(subcategory, (map.get(subcategory) ?? 0) + item.amount);
      matchedSum += item.amount;
    }
    const remainder = tx.amount - matchedSum;
    if (remainder > 0) {
      map.set('其他', (map.get('其他') ?? 0) + remainder);
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

export function buildSubcategoryEmbedFields(
  subtotals: SubcategoryTotal[]
): { name: string; value: string; inline: boolean }[] {
  return subtotals.map((t) => ({
    name: t.subcategory,
    value: `NT$${t.total.toLocaleString()}`,
    inline: true,
  }));
}
