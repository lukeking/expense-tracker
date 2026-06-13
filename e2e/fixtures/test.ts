import { test as base, expect } from '@playwright/test';
import { seedAuth, TEST_API_KEY } from './auth';
import { resetDb } from './reset-db';

// Shared test fixture: resets the DB to the baseline before each test and seeds the
// PWA auth key so the app is authenticated on first load.
export const test = base.extend({
  page: async ({ page }, use) => {
    await seedAuth(page);
    await use(page);
  },
});

test.beforeEach(async () => {
  await resetDb();
});

export { expect, TEST_API_KEY };
