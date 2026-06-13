import { test, expect, TEST_API_KEY } from '../fixtures/test';
import { BASELINE_FROM, BASELINE_TO, BASELINE_TOTALS } from '../fixtures/baseline';

// US1 — verifies the reproducible local environment: PWA serves, backend is reachable
// with auth against the local DB, the category catalog is seeded, and the per-test reset
// restores the baseline.
const API_URL = 'http://localhost:8787';
const authHeaders = { Authorization: `Bearer ${TEST_API_KEY}` };

test('PWA serves and loads', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.ok()).toBeTruthy();
  await expect(page.locator('#root')).toBeVisible();
});

test('backend is reachable with auth and the category catalog is seeded', async ({ request }) => {
  const res = await request.get(`${API_URL}/pwa/categories`, { headers: authHeaders });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { categories: { major: string; subcategory: string | null }[] };
  // The live-catalog snapshot (137 rows) is loaded — assert representative majors exist.
  const majors = new Set(body.categories.map((c) => c.major));
  expect(majors.has('食')).toBeTruthy();
  expect(majors.has('行')).toBeTruthy();
  expect(body.categories.length).toBeGreaterThan(50);
});

test('per-test reset restores the baseline transactions', async ({ request }) => {
  const res = await request.get(
    `${API_URL}/pwa/transactions?from=${BASELINE_FROM}&to=${BASELINE_TO}`,
    { headers: authHeaders }
  );
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { total: number };
  expect(body.total).toBe(BASELINE_TOTALS.count);
});
