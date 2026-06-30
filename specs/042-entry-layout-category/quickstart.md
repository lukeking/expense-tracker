# Quickstart: Entry Fee/Refund Layout + Major-Category Selector

**Feature**: 042-entry-layout-category | **Date**: 2026-06-29

Manual verification on the running PWA. Frontend-only; no backend/DB setup beyond the usual dev stack.

## Run

```bash
cd pwa
pnpm dev   # serves on http://localhost:5300
```

Set `localStorage.expense_api_key` in the browser if the app requires it (same as other PWA dev sessions). Use a mobile viewport (≈390px) in dev tools.

## Build gates

```bash
cd pwa
pnpm exec tsc -b        # type-check
pnpm i18n:check         # zh/en parity (skips comments; honors i18n-allow)
```

## A. Fee/Refund layout

1. Open the **手續費** tab. Confirm field order top-to-bottom: **金額 → 連結原始交易 → 付款方式 → 分類 → 說明**. 金額 reads as 「附加成本」.
2. Open the **退款** tab. Confirm order: **金額 → 連結原始交易 → 退款至 → 說明** (no 分類). 金額 shows the green 「+ … 退回」 framing.
3. On either tab, search and link an original. Confirm the link renders as a **card** under 金額: 🔗 + description + `付款 · 分類 · NT$金額 · 日期` + ✕.
4. Confirm downstream fields auto-fill (fee: 付款 + 分類 if single-category; refund: 退款至) and stay editable. Edit one, then re-link a different original → the edited field is **not** overwritten.
5. Tap ✕ to clear the link → other entered values remain.
6. 退款: with an original linked, tap 全額退 → amount becomes the original amount; card shows 原金額. Trim it for a partial.
7. Fill required fields → the inline **✓ 必填已完成…可送出** hint appears above 送出.
8. Validation: refund with empty 說明 stays blocked; fee with empty 說明 submits (defaults applied).

## B. Major-category selector

1. On 支出 or 手續費, open the category area. Confirm the major row shows a **small top-N set + 「⋯ 更多」** and **does not scroll horizontally** at 390px.
2. Confirm the inline majors are the **most-used first** (record a few entries under one major, reload, confirm it floats up).
3. Tap 「⋯ 更多」 → BottomSheet lists **all** majors with icons; pick one → it selects and the sheet closes.
4. Select a major with many subs → sub-chips are **most-used first**; overflow sheet (with search) also frequency-ordered.
5. Fresh/empty data → selector renders in default order without error.

## Expected outcome

- Both fee/refund tabs match the synced design references (`pwa/design-preview/refined/entry-fee|entry-refund/optimized.html`).
- Major categories fully reachable with zero horizontal scroll.
- No regression in auto-fill or submit validation.

## Optional e2e

Add/extend a Playwright smoke under `e2e/` asserting (a) fee/refund field order, and (b) major row has no horizontal overflow + 更多 opens the sheet. Note: e2e needs the local Supabase stack and is not in CI (run locally).
