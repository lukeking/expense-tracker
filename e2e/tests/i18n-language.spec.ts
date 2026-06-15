import { test, expect } from '../fixtures/test';

// Feature 029 — verifies the i18n language switch end-to-end in a real browser.
// The default-zh behaviour is already exercised by the other specs; here we assert
// that a stored English preference renders the UI in English with no zh chrome leak,
// and that a fresh state still defaults to Traditional Chinese.

test('renders in English when lang=en is stored', async ({ page }) => {
  // Seed the language preference before any app code runs (mirrors how auth is seeded).
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('lang', 'en');
    } catch {
      /* localStorage unavailable — ignore */
    }
  });

  await page.goto('/');

  // Bottom-nav labels render in English…
  await expect(page.getByText('Entry', { exact: true })).toBeVisible();
  await expect(page.getByText('Summary', { exact: true })).toBeVisible();
  // …and the default zh nav label is gone (no chrome leak — SC-002).
  await expect(page.getByText('記帳', { exact: true })).toHaveCount(0);
});

test('defaults to Traditional Chinese with no stored language', async ({ page }) => {
  // Fresh context → no localStorage['lang'] → zh default (SC-004).
  await page.goto('/');

  await expect(page.getByText('記帳', { exact: true })).toBeVisible();
});
