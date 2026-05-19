import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export type WindowOption = 'month' | 'last-month' | '3months' | 'half-year' | 'year' | 'all';

const UTC8 = 8 * 60 * 60 * 1000;

export function windowToDates(window: WindowOption): { from: string; to: string } {
  const now = new Date();
  const utc8Now = new Date(now.getTime() + UTC8);
  const y = utc8Now.getUTCFullYear();
  const m = utc8Now.getUTCMonth();

  function utc8Date(year: number, month: number, day: number): string {
    return new Date(Date.UTC(year, month, day) - UTC8).toISOString().slice(0, 10);
  }

  const today = utc8Now.toISOString().slice(0, 10);

  switch (window) {
    case 'month':
      return { from: utc8Date(y, m, 1), to: today };
    case 'last-month':
      return { from: utc8Date(y, m - 1, 1), to: utc8Date(y, m, 1) };
    case '3months':
      return { from: utc8Date(y, m - 3, utc8Now.getUTCDate()), to: today };
    case 'half-year':
      return { from: utc8Date(y, m - 6, utc8Now.getUTCDate()), to: today };
    case 'year':
      return { from: utc8Date(y - 1, m, utc8Now.getUTCDate()), to: today };
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
