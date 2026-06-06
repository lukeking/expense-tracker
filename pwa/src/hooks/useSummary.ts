import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export type TimeBase = 'week' | 'month' | 'year' | 'all';

const MONTH_LABELS = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

function pad(n: number) { return String(n).padStart(2, '0'); }
function localDateStr(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

function shortDay(d: Date) {
  return `${d.getMonth()+1}/${d.getDate()}`;
}

export function timeBaseToRange(base: TimeBase, offset: number): { from: string; to: string; label: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  if (base === 'week') {
    const dow = now.getDay(); // 0=Sun
    const thisSun = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow + offset * 7);
    const thisSat = new Date(thisSun.getFullYear(), thisSun.getMonth(), thisSun.getDate() + 6);
    const from = localDateStr(thisSun);
    const to = localDateStr(thisSat);
    const label = `${shortDay(thisSun)} – ${shortDay(thisSat)}`;
    return { from, to, label };
  }

  if (base === 'month') {
    const target = new Date(y, m + offset, 1);
    const ty = target.getFullYear();
    const tm = target.getMonth();
    const lastDay = new Date(ty, tm + 1, 0).getDate();
    const from = `${ty}-${pad(tm+1)}-01`;
    const to = `${ty}-${pad(tm+1)}-${pad(lastDay)}`;
    const label = `${MONTH_LABELS[tm]} ${ty}`;
    return { from, to, label };
  }

  if (base === 'year') {
    const ty = y + offset;
    return { from: `${ty}-01-01`, to: `${ty}-12-31`, label: `${ty}` };
  }

  // all
  return { from: '2000-01-01', to: localDateStr(now), label: '全部' };
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

export function useSummaryData(base: TimeBase, offset: number, tag?: string | null, paymentMethod?: string | null) {
  const { from, to } = timeBaseToRange(base, offset);
  const tagParam = tag ? `&tag=${encodeURIComponent(tag)}` : '';
  const pmParam = paymentMethod ? `&payment_method=${encodeURIComponent(paymentMethod)}` : '';
  return useQuery({
    queryKey: ['summary', base, offset, tag ?? null, paymentMethod ?? null],
    queryFn: () => apiFetch<SummaryData>(`/pwa/summary?from=${from}&to=${to}${tagParam}${pmParam}`),
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

export function useSubcategoryData(major: string | null, base: TimeBase, offset: number, tag?: string | null, paymentMethod?: string | null) {
  const { from, to } = timeBaseToRange(base, offset);
  const tagParam = tag ? `&tag=${encodeURIComponent(tag)}` : '';
  const pmParam = paymentMethod ? `&payment_method=${encodeURIComponent(paymentMethod)}` : '';
  return useQuery({
    queryKey: ['subcategories', major, base, offset, tag ?? null, paymentMethod ?? null],
    queryFn: () => apiFetch<SubcategoryData>(`/pwa/summary/subcategories?from=${from}&to=${to}&major=${encodeURIComponent(major!)}${tagParam}${pmParam}`),
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

export interface PeriodData {
  period: string;
  from_date: string;
  to_date: string;
  tx_count: number;
  total: number;
}

const BASE_LIMIT: Record<TimeBase, number> = {
  week: 200,
  month: 300,
  year: 2000,
  // Higher cap for the 全部 (all-time) filtered list: tag/category filtering happens
  // in memory on the fetched page, so this bounds how far back a filtered all-time
  // view reaches. Only loaded when a filter/drilldown is active (see `enabled` below).
  all: 2000,
};

export interface TransactionsData {
  total: number;
  page: number;
  transactions: TxRecord[];
}

export function useTransactions(base: TimeBase, offset: number, category?: string | null, tag?: string | null, paymentMethod?: string | null) {
  const { from, to } = timeBaseToRange(base, offset);
  const limit = BASE_LIMIT[base];
  const categoryParam = category ? `&category=${encodeURIComponent(category)}` : '';
  const tagParam = tag ? `&tag=${encodeURIComponent(tag)}` : '';
  const pmParam = paymentMethod ? `&payment_method=${encodeURIComponent(paymentMethod)}` : '';
  return useQuery({
    queryKey: ['transactions', base, offset, category ?? null, tag ?? null, paymentMethod ?? null],
    queryFn: () =>
      apiFetch<TransactionsData>(`/pwa/transactions?from=${from}&to=${to}&limit=${limit}${categoryParam}${tagParam}${pmParam}`),
    // 全部 normally renders the lazy per-period list; only fetch the flat transaction
    // list under 全部 when a filter/drilldown is active so it can be shown filtered.
    enabled: base !== 'all' || !!category || !!tag || !!paymentMethod,
    staleTime: 30_000,
  });
}

export function useTransactionPeriods(base: TimeBase) {
  const { from, to } = timeBaseToRange('all', 0);
  return useQuery({
    queryKey: ['tx-periods'],
    queryFn: () => apiFetch<PeriodData[]>(`/pwa/transaction-periods?from=${from}&to=${to}`),
    enabled: base === 'all',
    staleTime: 300_000,
  });
}

export function useMonthTransactions(from: string, to: string, enabled: boolean) {
  return useQuery({
    queryKey: ['tx-month', from, to],
    queryFn: () => apiFetch<TransactionsData>(`/pwa/transactions?from=${from}&to=${to}&limit=300`),
    enabled,
    staleTime: 300_000,
  });
}
