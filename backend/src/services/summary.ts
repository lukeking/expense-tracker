import type { SummaryPeriod, Transaction } from '../types';

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface SubcategoryTotal {
  subcategory: string;
  total: number;
}

export function periodToDateRange(period: SummaryPeriod): { from: Date; to: Date } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed

  switch (period) {
    case 'month':
      return { from: new Date(Date.UTC(y, m, 1)), to: now };
    case 'last-month': {
      const firstOfThisMonth = new Date(Date.UTC(y, m, 1));
      const firstOfLastMonth = new Date(Date.UTC(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1));
      return { from: firstOfLastMonth, to: firstOfThisMonth };
    }
    case '3months':
      return { from: new Date(Date.UTC(y, m - 3, now.getUTCDate())), to: now };
    case 'half-year':
      return { from: new Date(Date.UTC(y, m - 6, now.getUTCDate())), to: now };
    case 'year':
      return { from: new Date(Date.UTC(y - 1, m, now.getUTCDate())), to: now };
    case 'all':
      return { from: new Date(0), to: now };
  }
}

export function aggregateByCategory(transactions: Transaction[]): CategoryTotal[] {
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

  const top5 = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  const restTotal = rest.reduce((sum, c) => sum + c.total, 0);

  const othersEntry = top5.find((c) => c.category === '其他');
  if (othersEntry) {
    othersEntry.total += restTotal;
  } else {
    top5.push({ category: '其他', total: restTotal });
  }
  return top5;
}

export function aggregateBySubcategory(transactions: Transaction[], category: string): SubcategoryTotal[] {
  const map = new Map<string, number>();
  for (const tx of transactions) {
    const categoryTag = tx.tags.find((t) => t.includes(':')) ?? null;
    const txCategory = categoryTag ? categoryTag.split(':')[0] : '其他';
    if (txCategory !== category) continue;
    const subcategory = categoryTag ? (categoryTag.split(':').slice(1).join(':') || '其他') : '其他';
    map.set(subcategory, (map.get(subcategory) ?? 0) + tx.amount);
  }

  if (map.size === 0) return [];

  return Array.from(map.entries())
    .map(([subcategory, total]) => ({ subcategory, total }))
    .sort((a, b) => b.total - a.total);
}
