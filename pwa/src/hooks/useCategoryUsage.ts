import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';
import { useCategories } from './useCategories';

// Derived, client-side usage ranking for categories. Categories are stored as `主:子`
// colon-tags inside transaction + item tags (no dedicated column), so we count their
// presence across a bounded recent window of transactions, once per session (memoized).
// No new backend — reuses the existing /pwa/transactions endpoint.

const USAGE_WINDOW_DAYS = 180;
const USAGE_LIMIT = 2000;

interface TxLite {
  tags: string[];
  items?: { tags: string[] }[];
}

export interface CategoryUsage {
  majorRank: string[];
  subRank: Map<string, string[]>;
  hasData: boolean;
}

function recentRange(days: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return { from: fmt(from), to: fmt(to) };
}

export function useCategoryUsage(): CategoryUsage {
  const { data: categories } = useCategories();
  // Stable within a day (YYYY-MM-DD strings) → no refetch loop.
  const { from, to } = recentRange(USAGE_WINDOW_DAYS);

  const { data } = useQuery({
    queryKey: ['category-usage', from, to],
    queryFn: () =>
      apiFetch<{ transactions: TxLite[] }>(
        `/pwa/transactions?from=${from}&to=${to}&limit=${USAGE_LIMIT}`
      ),
    staleTime: 30 * 60_000,
  });

  return useMemo<CategoryUsage>(() => {
    const empty: CategoryUsage = { majorRank: [], subRank: new Map(), hasData: false };
    if (!data?.transactions || !categories) return empty;

    const majors = [...new Set(categories.map((c) => c.major))];
    const majorSet = new Set(majors);
    const majorCount = new Map<string, number>();
    const subCount = new Map<string, number>(); // key: `major:sub`

    for (const tx of data.transactions) {
      const tagSet = new Set<string>(tx.tags ?? []);
      for (const it of tx.items ?? []) for (const tag of it.tags ?? []) tagSet.add(tag);
      const seenMajor = new Set<string>();
      const seenSub = new Set<string>();
      for (const tag of tagSet) {
        const idx = tag.indexOf(':');
        if (idx <= 0) continue;
        const major = tag.slice(0, idx);
        if (!majorSet.has(major)) continue;
        if (!seenMajor.has(major)) {
          majorCount.set(major, (majorCount.get(major) ?? 0) + 1);
          seenMajor.add(major);
        }
        if (!seenSub.has(tag)) {
          subCount.set(tag, (subCount.get(tag) ?? 0) + 1);
          seenSub.add(tag);
        }
      }
    }

    const hasData = majorCount.size > 0;

    // Tie-break by natural order (Array.sort is stable; majors carry sort_order order).
    const majorIndex = new Map(majors.map((m, i) => [m, i]));
    const majorRank = [...majors].sort((a, b) => {
      const d = (majorCount.get(b) ?? 0) - (majorCount.get(a) ?? 0);
      return d !== 0 ? d : (majorIndex.get(a) ?? 0) - (majorIndex.get(b) ?? 0);
    });

    const subRank = new Map<string, string[]>();
    for (const major of majors) {
      const subs = categories
        .filter((c) => c.major === major && c.subcategory)
        .map((c) => c.subcategory as string);
      const sorted = [...subs].sort(
        (a, b) => (subCount.get(`${major}:${b}`) ?? 0) - (subCount.get(`${major}:${a}`) ?? 0)
      );
      subRank.set(major, sorted);
    }

    return { majorRank, subRank, hasData };
  }, [data, categories]);
}
