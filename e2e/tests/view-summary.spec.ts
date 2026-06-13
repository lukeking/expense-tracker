import { test, expect } from '../fixtures/test';
import { BASELINE_TOTALS } from '../fixtures/baseline';

// US3 — drives the summary view and asserts aggregates over the known baseline.
// The baseline lives in a past month, so we use the 全部 (all-time) time base.
const money = (n: number) => `NT$${n.toLocaleString()}`;

test('summary shows the baseline grand total and category breakdown', async ({ page }) => {
  await page.goto('/#/summary');
  await page.getByRole('button', { name: '全部', exact: true }).click();

  // Grand total = sum of the baseline transactions.
  await expect(page.getByText(money(BASELINE_TOTALS.grand), { exact: true })).toBeVisible(); // NT$410
  // The 食 category row shows its aggregate.
  await expect(page.getByText(money(BASELINE_TOTALS.byMajor['食']), { exact: true })).toBeVisible(); // NT$350
});

test('drilling into a category filters the view to that category', async ({ page }) => {
  await page.goto('/#/summary');
  await page.getByRole('button', { name: '全部', exact: true }).click();

  // Click the 食 category row → drilldown (a filtered, single-category view).
  await page.getByRole('button', { name: /食/ }).first().click();

  // Drilldown chrome appears and the header still totals only 食's spend.
  await expect(page.getByText('← 返回')).toBeVisible();
  await expect(page.getByText(money(BASELINE_TOTALS.byMajor['食']), { exact: true }).first()).toBeVisible(); // NT$350 header, not the 410 grand
});
