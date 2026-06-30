import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/test';

// T015 — spec 042 entry layout + major-category selector smokes. Frontend-only: no
// transactions are created, only the category catalog is read. Proves the restructured
// fee/refund field order (US1/US3) and that the major-category row fits one mobile line
// with a working 「更多」 overflow sheet (US2). The field-order and sheet behaviour have
// design-synced screenshots upstream; this is the cheapest live-DOM regression net.

const MOBILE = { width: 390, height: 844 };

// Asserts the section <label>s appear top-to-bottom in `fields` order. The form is a single
// flex column, so DOM order (allTextContents) equals visual order. Match each field by the
// label's LEADING text — a plain substring would false-hit hint spans that embed another
// field's name (e.g. the fee 連結 hint "· 帶入付款・分類" contains 分類).
async function expectFieldOrder(page: Page, fields: string[]): Promise<void> {
  const texts = (await page.locator('form label').allTextContents()).map((s) => s.trim());
  let prevIdx = -1;
  let prevField = '(start)';
  for (const field of fields) {
    const idx = texts.findIndex((t) => t.startsWith(field));
    expect(idx, `「${field}」 label should render`).toBeGreaterThanOrEqual(0);
    expect(idx, `「${field}」 should sit below 「${prevField}」`).toBeGreaterThan(prevIdx);
    prevIdx = idx;
    prevField = field;
  }
}

test.describe('entry layout — spec 042', () => {
  test('fee field order: 金額 → 連結原始交易 → 付款方式 → 分類 → 說明', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '手續費', exact: true }).click();
    await expect(page.getByPlaceholder('搜尋交易備註或品項…')).toBeVisible(); // form mounted
    await expectFieldOrder(page, ['金額', '連結原始交易', '付款方式', '分類', '說明']);
  });

  test('refund field order: 金額 → 連結原始交易 → 退款至 → 說明 (no 分類)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '退款', exact: true }).click();
    await expect(page.getByPlaceholder('搜尋交易備註或品項…')).toBeVisible(); // form mounted
    await expectFieldOrder(page, ['金額', '連結原始交易', '退款至', '說明']);
    // Refund intentionally has no category field.
    const labels = (await page.locator('form label').allTextContents()).map((s) => s.trim());
    expect(labels.some((t) => t.startsWith('分類')), 'refund has no 分類 field').toBe(false);
  });

  test('major chips fit one row at 390px and 「更多」 opens the all-majors sheet', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/');
    // Default tab is 支出 (ExpenseForm), the only form hosting a CategoryPicker by default.
    const moreBtn = page.getByRole('button', { name: /更多/ });
    await expect(moreBtn).toBeVisible();

    // The major row is the flex-wrap container that holds 「更多」. Every chip in it must
    // share one line (no wrap to a second row → "no overflow") at the 390px mobile width.
    const majorRow = page.locator('div.flex.flex-wrap', { has: moreBtn }).first();
    const chips = majorRow.getByRole('button');
    const n = await chips.count();
    expect(n).toBeGreaterThan(1);
    const tops: number[] = [];
    for (let i = 0; i < n; i++) {
      const box = await chips.nth(i).boundingBox();
      if (box) tops.push(box.y);
    }
    expect(Math.max(...tops) - Math.min(...tops), 'all major chips share one row').toBeLessThan(8);

    // 「更多」 opens the all-majors bottom sheet.
    await moreBtn.click();
    await expect(page.getByText('所有主分類')).toBeVisible();
  });
});
