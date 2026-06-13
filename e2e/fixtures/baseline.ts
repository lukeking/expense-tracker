// Deterministic baseline transactions, re-inserted before each test (see reset-db.ts).
// Small integer amounts in one known month so summary aggregates are obvious by inspection.

export interface BaselineItem {
  name: string;
  amount: number;
  tags: string[];
}

export interface BaselineTx {
  amount: number;
  transaction_type: string;
  payment_method: string;
  tags: string[];
  note: string | null;
  transaction_at: string; // ISO timestamp
  items: BaselineItem[];
}

export const BASELINE_MONTH = '2026-03';
export const BASELINE_FROM = '2026-03-01';
export const BASELINE_TO = '2026-03-31';

export const BASELINE_TRANSACTIONS: BaselineTx[] = [
  {
    amount: 100,
    transaction_type: 'expense',
    payment_method: 'cash',
    tags: ['食:早餐'],
    note: 'baseline breakfast',
    transaction_at: '2026-03-05T08:00:00Z',
    items: [{ name: '蛋餅', amount: 100, tags: ['食:早餐'] }],
  },
  {
    amount: 250,
    transaction_type: 'expense',
    payment_method: 'credit_card',
    tags: ['食:午餐'],
    note: 'baseline lunch',
    transaction_at: '2026-03-12T12:30:00Z',
    items: [{ name: '便當', amount: 250, tags: ['食:午餐'] }],
  },
  {
    amount: 60,
    transaction_type: 'expense',
    payment_method: 'easy_card',
    tags: ['行:捷運'],
    note: 'baseline transit',
    transaction_at: '2026-03-20T18:00:00Z',
    items: [{ name: '捷運', amount: 60, tags: ['行:捷運'] }],
  },
];

// Known aggregates for summary assertions.
export const BASELINE_TOTALS = {
  count: BASELINE_TRANSACTIONS.length, // 3
  grand: BASELINE_TRANSACTIONS.reduce((s, t) => s + t.amount, 0), // 410
  byMajor: { 食: 350, 行: 60 } as Record<string, number>,
};
