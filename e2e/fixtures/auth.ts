import { type Page } from '@playwright/test';

// Single source of truth for the local E2E auth key.
// MUST match ANDROID_API_KEY in backend/.dev.vars.e2e (see .dev.vars.e2e.example).
export const TEST_API_KEY = 'e2e-test-key';

// Seed the PWA's auth key into localStorage before app code runs, so apiFetch sends
// `Authorization: Bearer <TEST_API_KEY>` and the /pwa/* androidAuth gate passes.
export async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      window.localStorage.setItem('expense_api_key', key);
    } catch {
      /* localStorage unavailable — ignore */
    }
  }, TEST_API_KEY);
}
