import { test, expect, TEST_API_KEY } from '../fixtures/test';

// US2 — drives the add-expense journey through the real PWA UI and asserts persistence.
const API_URL = 'http://localhost:8787';
const authHeaders = { Authorization: `Bearer ${TEST_API_KEY}` };
const ITEM_NAME = 'E2E品項';

test('submits an expense through the UI and persists it', async ({ page, request }) => {
  await page.goto('/');

  // Amount (the large header field, placeholder "0").
  await page.getByPlaceholder('0').fill('123');
  // Category: pick the 食 major chip (rendered with an emoji prefix, e.g. "🍜 食",
  // so match by substring rather than exact).
  await page.getByRole('button', { name: '食' }).click();
  // A subcategory is required to complete the category (major-only is blocked from submit).
  await page.getByRole('button', { name: '早餐', exact: true }).click();
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
  // The guard keeps submit inert until a positive amount is entered. The button stays in the
  // DOM (its label folds to the missing-fields hint instead of 送出) and signals blocked via
  // aria-disabled rather than the native disabled attribute.
  await expect(page.locator('button[type="submit"]')).toHaveAttribute('aria-disabled', 'true');
});
