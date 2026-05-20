import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export type WindowOption = 'month' | 'last-month' | '3months' | 'half-year' | 'year' | 'all';

export function windowToDates(window: WindowOption): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  function localDate(year: number, month: number, day: number): string {
    const dt = new Date(year, month, day);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  const today = localDate(y, m, d);

  switch (window) {
    case 'month':
      return { from: localDate(y, m, 1), to: today };
    case 'last-month':
      return { from: localDate(y, m - 1, 1), to: localDate(y, m, 1) };
    case '3months':
      return { from: localDate(y, m - 3, d), to: today };
    case 'half-year':
      return { from: localDate(y, m - 6, d), to: today };
    case 'year':
      return { from: localDate(y - 1, m, d), to: today };
    case 'all':
      return { from: '2020-01-01', to: today };
  }
}

export interface CategorySummary {
  category: string;
  total: number;
  percentage: number;
}

export interface SummaryData {
  grand_total: number;
  categories: CategorySummary[];
}

export function useSummaryData(window: WindowOption) {
  const { from, to } = windowToDates(window);
  return useQuery({
    queryKey: ['summary', window],
    queryFn: () => apiFetch<SummaryData>(`/pwa/summary?from=${from}&to=${to}`),
    staleTime: 60_000,
  });
}

export interface SubcategorySummary {
  subcategory: string;
  total: number;
  percentage: number;
}

export interface SubcategoryData {
  major: string;
  total: number;
  subcategories: SubcategorySummary[];
}

export function useSubcategoryData(major: string | null, window: WindowOption) {
  const { from, to } = windowToDates(window);
  return useQuery({
    queryKey: ['subcategories', major, window],
    queryFn: () => apiFetch<SubcategoryData>(`/pwa/summary/subcategories?from=${from}&to=${to}&major=${encodeURIComponent(major!)}`),
    enabled: major !== null,
    staleTime: 60_000,
  });
}

export interface TxItem {
  id: string;
  name: string;
  amount: number | null;
  tags: string[];
}

export interface TxRecord {
  id: string;
  amount: number;
  transaction_type: string;
  payment_method: string;
  tags: string[];
  note: string | null;
  transaction_at: string;
  created_at: string;
  parent_transaction_id: string | null;
  items: TxItem[];
}

export interface TransactionsData {
  total: number;
  page: number;
  transactions: TxRecord[];
}

export function useTransactions(window: WindowOption, category?: string | null, page = 1) {
  const { from, to } = windowToDates(window);
  const categoryParam = category ? `&category=${encodeURIComponent(category)}` : '';
  return useQuery({
    queryKey: ['transactions', window, category ?? null, page],
    queryFn: () =>
      apiFetch<TransactionsData>(`/pwa/transactions?from=${from}&to=${to}&page=${page}&limit=100${categoryParam}`),
    staleTime: 30_000,
  });
}
