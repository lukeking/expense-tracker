import type { SummaryPeriod, CategoryTotal, SubcategoryTotal } from '../types';

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
  transactions: { amount: number; tags: string[] }[]
): CategoryTotal[] {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    const categoryTag = tx.tags.find((t) => t.includes(':')) ?? null;
    const category = categoryTag ? categoryTag.split(':')[0] : '其他';
    map.set(category, (map.get(category) ?? 0) + tx.amount);
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
  transactions: { amount: number; tags: string[] }[],
  category: string
): SubcategoryTotal[] {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    const categoryTag = tx.tags.find((t) => t.startsWith(category + ':')) ?? null;
    const subcategory = categoryTag
      ? categoryTag.split(':').slice(1).join(':') || '其他'
      : '其他';
    map.set(subcategory, (map.get(subcategory) ?? 0) + tx.amount);
  }
  return Array.from(map.entries())
    .map(([subcategory, total]) => ({ subcategory, total }))
    .sort((a, b) => b.total - a.total);
}

export function formatCategoryTable(totals: CategoryTotal[]): string {
  const grandTotal = totals.reduce((s, t) => s + t.total, 0);
  const header = '| 分類 | 金額 | 占比 |\n|------|------|------|';
  const rows = totals.map((t) => {
    const pct = grandTotal > 0 ? Math.round((t.total / grandTotal) * 100) : 0;
    return `| ${t.category} | NT$${t.total.toLocaleString()} | ${pct}% |`;
  });
  return [header, ...rows, '', `💰 合計：NT$${grandTotal.toLocaleString()}`].join('\n');
}
