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

// Feature 030 (US1) — tapping a subcategory bar narrows the drilldown list to that
// subcategory, day-grouped, with the header showing its net total. 食 has two
// item-tagged subcategories: 午餐 (NT$250) and 早餐 (NT$100).
test('tapping a subcategory bar filters the drilldown to that subcategory', async ({ page }) => {
  await page.goto('/#/summary');
  await page.getByRole('button', { name: '全部', exact: true }).click();

  // Drill into 食 (350 = 午餐 250 + 早餐 100).
  await page.getByRole('button', { name: /食/ }).first().click();
  await expect(page.getByText('← 返回')).toBeVisible();
  await expect(page.getByText(money(350), { exact: true }).first()).toBeVisible();

  // Two subcategory bars, sorted by total desc: nth(0) = 午餐 (250), nth(1) = 早餐 (100).
  const bars = page.locator('.recharts-bar-rectangle');
  await expect(bars).toHaveCount(2);

  // Tap 午餐 → breadcrumb header + its net total. (The amount column always lists every
  // subcategory, dimming the unselected ones rather than removing them, so assert the
  // selection via the breadcrumb — not by the other subtotal vanishing.) The major total
  // (350) does leave the page once a subcategory is active.
  await bars.nth(0).click();
  await expect(page.getByText('食 › 午餐')).toBeVisible();
  await expect(page.getByText(money(250), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(money(350), { exact: true })).toHaveCount(0);

  // Tap a different bar (早餐) → selection replaces, not stacks (FR-003): breadcrumb + total switch.
  await bars.nth(1).click();
  await expect(page.getByText('食 › 早餐')).toBeVisible();
  await expect(page.getByText(money(100), { exact: true }).first()).toBeVisible();

  // Day-grouped: expanding the month group reveals the subcategory's day (SC-002 — with
  // one tx the single day subtotal equals the header total, both NT$100).
  await page.getByRole('button', { name: /2026\/03/ }).click();
  await expect(page.getByText('03/05', { exact: true })).toBeVisible(); // 早餐 tx day
});

// Feature 030 (FR-004) — the subcategory filter composes with an active payment-method
// filter: credit_card leaves only the lunch tx (午餐, 250) within 食.
test('subcategory filter composes with an active payment-method filter', async ({ page }) => {
  await page.goto('/#/summary');
  await page.getByRole('button', { name: '全部', exact: true }).click();

  await page.getByRole('button', { name: '信用卡', exact: true }).click(); // credit_card only

  await page.getByRole('button', { name: /食/ }).first().click();
  // Only 午餐 survives the payment filter, so a single bar remains.
  const bars = page.locator('.recharts-bar-rectangle');
  await expect(bars).toHaveCount(1);

  await bars.nth(0).click();
  await expect(page.getByText(money(250), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(money(100), { exact: true })).toHaveCount(0);
});

// Feature 030 (US2, FR-006) — the subcategory filter clears two ways: re-tapping the
// active bar, and the dedicated clear control. Both restore the full major-category list
// (the major total NT$350 returns).
test('clearing the subcategory filter restores the full major list (both ways)', async ({ page }) => {
  await page.goto('/#/summary');
  await page.getByRole('button', { name: '全部', exact: true }).click();

  await page.getByRole('button', { name: /食/ }).first().click();
  const bars = page.locator('.recharts-bar-rectangle');
  await expect(bars).toHaveCount(2);

  // Select 午餐 → filtered (major total gone); re-tap the same bar → cleared (350 back).
  await bars.nth(0).click();
  await expect(page.getByText(money(350), { exact: true })).toHaveCount(0);
  await bars.nth(0).click();
  await expect(page.getByText(money(350), { exact: true }).first()).toBeVisible();

  // Select again → filtered; tap the clear control (✕ 全部) → cleared (350 back).
  await bars.nth(0).click();
  await expect(page.getByText(money(350), { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '✕ 全部', exact: true }).click();
  await expect(page.getByText(money(350), { exact: true }).first()).toBeVisible();
});

// Feature 030 (FR-001) — the whole row band is clickable, not just the coloured bar.
// Clicking the empty right-hand side of a short bar's row still selects it (regression
// for tapping the light-grey area of a small bar).
test('clicking the empty part of a row selects that subcategory', async ({ page }) => {
  await page.goto('/#/summary');
  await page.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByRole('button', { name: /食/ }).first().click();

  const surface = page.locator('.recharts-surface').first();
  await expect(surface).toBeVisible();
  const box = (await surface.boundingBox())!;
  // 食 has two rows: 午餐 (top, long bar) and 早餐 (bottom, short bar). Click the far-right
  // of the 早餐 row — well past its short bar but inside the plot (the right 76px is the
  // reserved amount column / chart margin, outside the clickable band) — to prove the whole
  // band selects, not just the coloured bar.
  await surface.click({ position: { x: box.width - 90, y: box.height * 0.75 } });

  await expect(page.getByText('食 › 早餐')).toBeVisible();
  await expect(page.getByText(money(100), { exact: true }).first()).toBeVisible();
});

// Feature 030 (US3, FR-008/FR-009) — the active subcategory is obvious: the header
// becomes a breadcrumb (Major › Sub) with the net total, and the non-selected bars take
// the shade. Both revert on clear.
test('the active subcategory shows a breadcrumb header and shades the other bars', async ({ page }) => {
  await page.goto('/#/summary');
  await page.getByRole('button', { name: '全部', exact: true }).click();

  await page.getByRole('button', { name: /食/ }).first().click();
  const bars = page.locator('.recharts-bar-rectangle');
  await expect(bars).toHaveCount(2);
  // No shade before a subcategory is selected.
  await expect(page.locator('.recharts-rectangle[fill-opacity="0.25"]')).toHaveCount(0);

  // Select 午餐 → breadcrumb + net total; the other bar (早餐) is shaded.
  await bars.nth(0).click();
  await expect(page.getByText('食 › 午餐')).toBeVisible();
  await expect(page.getByText(money(250), { exact: true }).first()).toBeVisible();
  await expect(page.locator('.recharts-rectangle[fill-opacity="0.25"]')).toHaveCount(1);

  // Clear → breadcrumb reverts to the major and the shade retracts.
  await page.getByRole('button', { name: '✕ 全部', exact: true }).click();
  await expect(page.getByText('食 › 午餐')).toHaveCount(0);
  await expect(page.locator('.recharts-rectangle[fill-opacity="0.25"]')).toHaveCount(0);
});
