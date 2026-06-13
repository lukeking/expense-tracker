import { test, expect, TEST_API_KEY } from '../fixtures/test';

// US2 — drives the add-expense journey through the real PWA UI and asserts persistence.
const API_URL = 'http://localhost:8787';
const authHeaders = { Authorization: `Bearer ${TEST_API_KEY}` };
const ITEM_NAME = 'E2E品項';

test('submits an expense through the UI and persists it', async ({ page, request }) => {
  await page.goto('/');

  // Amount (the large header field, placeholder "0").
  await page.getByPlaceholder('0').fill('123');
  // Category: pick the 食 major chip.
  await page.getByRole('button', { name: '食', exact: true }).click();
  // Item name.
  await page.getByPlaceholder('品項名稱').fill(ITEM_NAME);
  // Payment method.
  await page.getByRole('button', { name: '現金', exact: true }).click();
  // Submit.
  await page.getByRole('button', { name: '送出' }).click();

  // Success indication.
  await expect(page.getByText('記錄成功！')).toBeVisible();

  // Persistence: the new expense is retrievable through the app's API (wide range so
  // the assertion is independent of the server-assigned timestamp).
  const res = await request.get(`${API_URL}/pwa/transactions?from=2026-01-01&to=2026-12-31`, {
    headers: authHeaders,
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    transactions: { amount: number; payment_method: string; tags: string[]; items: { name: string }[] }[];
  };
  const created = body.transactions.find((t) => t.items.some((i) => i.name === ITEM_NAME));
  expect(created, 'created expense should be retrievable').toBeTruthy();
  expect(created!.amount).toBe(123);
  expect(created!.payment_method).toBe('cash');
  expect(created!.tags.some((t) => t === '食' || t.startsWith('食:'))).toBeTruthy();
});

test('blocks submit when the amount is empty', async ({ page }) => {
  await page.goto('/');
  // The app's existing guard disables submit until a positive amount is entered.
  await expect(page.getByRole('button', { name: '送出' })).toBeDisabled();
});
