import { test, expect, TEST_API_KEY } from '../fixtures/test';

// Feature 041 — 連結原始交易 auto-fill. Drives the fee/refund tabs through the real UI:
// linking an original auto-fills the form, and the refund 全額退款 button one-taps the
// original's amount. (Category resolution itself has dedicated backend unit tests in
// queries.test.ts; here we prove the end-to-end form wiring via the cleanest signals —
// payment_method, the auto-filled description, and the 全額退款 amount.)
const API_URL = 'http://localhost:8787';
const authHeaders = { Authorization: `Bearer ${TEST_API_KEY}` };

// A fresh parent dated "now" (the baseline rows are >90 days old, outside parent-search's
// default window). easy_card ≠ the form default (credit_card), so payment auto-fill is observable.
const PARENT_NOTE = 'E2E原始交易';

interface TxRow {
  amount: number;
  transaction_type: string;
  payment_method: string;
  tags: string[];
  note: string | null;
  items: { name: string }[];
}

async function createParent(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const res = await request.post(`${API_URL}/pwa/expense`, {
    headers: authHeaders,
    data: {
      amount: 200,
      payment_method: 'easy_card',
      category_tag: '行:捷運',
      note: PARENT_NOTE,
      items: [{ name: 'E2E捷運', amount: 200 }],
    },
  });
  expect(res.ok(), 'parent expense should be created').toBeTruthy();
}

async function fetchTransactions(request: import('@playwright/test').APIRequestContext): Promise<TxRow[]> {
  const res = await request.get(`${API_URL}/pwa/transactions?from=2026-01-01&to=2026-12-31`, { headers: authHeaders });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { transactions: TxRow[] }).transactions;
}

test('fee: linking an original auto-fills payment method and description', async ({ page, request }) => {
  await createParent(request);
  await page.goto('/');
  await page.getByRole('button', { name: '手續費', exact: true }).click();

  await page.getByPlaceholder('0').fill('47');

  // Link the original; do NOT touch payment/category — auto-fill must do it.
  await page.getByPlaceholder('搜尋交易備註或品項…').fill(PARENT_NOTE);
  await page.getByRole('button', { name: new RegExp(PARENT_NOTE) }).click();

  await page.getByRole('button', { name: '送出' }).click();
  await expect(page.getByText('手續費已記錄')).toBeVisible();

  const txs = await fetchTransactions(request);
  const fee = txs.find((t) => t.transaction_type === 'fee' && t.amount === 47);
  expect(fee, 'fee should be persisted').toBeTruthy();
  // Payment method was auto-filled from the original (easy_card), not left at the default.
  expect(fee!.payment_method).toBe('easy_card');
  // Category rode in via the link (auto-fill + parent-tag inheritance both yield 行:捷運).
  expect(fee!.tags.some((t) => t === '行:捷運')).toBeTruthy();
});

test('refund: 全額退款 one-taps the original amount; payment auto-fills', async ({ page, request }) => {
  await createParent(request);
  await page.goto('/');
  await page.getByRole('button', { name: '退款', exact: true }).click();

  // 全額退款 is absent until an original is linked.
  await expect(page.getByRole('button', { name: /全額退款/ })).toHaveCount(0);

  await page.getByPlaceholder('搜尋交易備註或品項…').fill(PARENT_NOTE);
  await page.getByRole('button', { name: new RegExp(PARENT_NOTE) }).click();

  // Now the button appears; tap it → amount becomes the original's full amount.
  await page.getByRole('button', { name: /全額退款/ }).click();
  await expect(page.getByPlaceholder('0')).toHaveValue('200');

  await page.getByRole('button', { name: '送出' }).click();
  await expect(page.getByText('退款已記錄')).toBeVisible();

  const txs = await fetchTransactions(request);
  const refund = txs.find((t) => t.transaction_type === 'refund');
  expect(refund, 'refund should be persisted').toBeTruthy();
  expect(refund!.amount).toBe(200);
  expect(refund!.payment_method).toBe('easy_card');
});
