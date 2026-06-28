# Quickstart: 連結原始交易 auto-fill

**Feature**: 041-parent-autofill | **Date**: 2026-06-28

How to exercise and verify the feature locally. Auto-fill is a create-time convenience on the Entry screen's 手續費 and 退款 tabs; the only backend change is two extra fields on `GET /pwa/parent-search`.

## Run

```bash
# backend (CF Worker)
cd backend && pnpm dev

# pwa (set the api key in localStorage first; dev server on :5300)
cd pwa && pnpm dev
```

## UI mockups

### 手續費 — before vs. after linking a single-category original

```
BEFORE link                          AFTER linking "iherb 訂單" (食:保健, credit_card)
┌────────────────────────────┐       ┌────────────────────────────┐
│ • 金額            [   45  ] │       │ • 金額            [   45  ] │  amount untouched
│ • 付款方式                  │       │ • 付款方式                  │
│   [現金][信用卡][悠遊卡]... │       │   [現金][信用卡✔][悠遊卡].. │  ← auto: parent's method
│ • 分類                      │       │ • 分類                      │
│   ( 選擇分類 … )            │       │   ( 食 › 保健 )             │  ← auto: parent's single category
│ • 說明                      │       │ • 說明                      │
│   [                      ]  │       │   [ iherb 訂單           ]  │  ← auto: parent label (was empty)
│ • 連結原始交易              │       │ • 連結原始交易              │
│   ( 搜尋… )                 │       │   [ iherb 訂單  NT$1280 ✕] │
└────────────────────────────┘       └────────────────────────────┘
```

If the linked original is multi-item with several categories (or uncategorized), the **分類** stays at `選擇分類 …` for the user to pick; payment + description still fill.

### 退款 — linking + 全額退款

```
AFTER linking "iherb 訂單" (NT$1280, credit_card)
┌────────────────────────────┐
│ • 金額            [   0   ] │   amount never auto-filled
│   [ 全額退款 ]              │   ← shown only when a parent is linked; tap → 金額 = 1280
│ • 說明                      │
│   [ iherb 訂單           ]  │   ← auto: parent label (was empty)  [parity with fee]
│ • 退款至                    │
│   [現金][信用卡✔][悠遊卡].. │   ← auto: parent's payment method
│ • 連結原始交易              │
│   [ iherb 訂單  NT$1280 ✕] │
└────────────────────────────┘
```

## Manual verification

1. **Payment auto-fill (P1, both tabs)**: On 手續費, type an amount, link an original paid by a *non-default* method → the payment pill switches to that method. Repeat on 退款 ("退款至").
2. **Manual choice survives (non-destructive)**: After linking, manually pick a different payment pill, then re-link to a *different* original → your manual pill is kept (not overwritten).
3. **Category single vs. ambiguous (P2, fee only)**: Link a single-category original → 分類 pre-fills. Link a multi-category (or uncategorized) original → 分類 stays empty.
4. **Category manual survives**: Pick a category by hand, then link an original → your category is kept.
5. **Description fill-when-empty (both tabs)**: With an empty 說明, link → it fills from the parent label. With 說明 already typed, link → your text is preserved. (Confirm 退款 now behaves like 手續費.)
6. **Amount never auto-fills**: Linking never changes 金額 on either tab.
7. **全額退款 (refund only)**: With no parent linked, the 全額退款 control is absent. Link a parent → it appears; tap → 金額 becomes the parent's full amount; edit 金額 down → your edit stays.
8. **Clear link**: Clear the linked original (✕) → no field is wiped.
9. **Submit resets**: Submit a linked entry → form returns to a clean state (fields + touched flags cleared); 全額退款 disappears (no parent).
10. **Post-submit**: The saved fee/refund keeps only the parent relationship; nothing about it re-syncs if the original later changes.

## Backend check

```bash
# expect each candidate to include payment_method and a category (主:子 or null)
curl -s "$BASE/pwa/parent-search?q=iherb&days=90" -H "x-api-key: $KEY" | jq '.transactions[0]'
```

## Automated checks

```bash
cd backend && pnpm test            # extend parent-search worker test; resolveSingleCategory unit test
cd pwa && pnpm exec tsc -b         # types for new ParentSearchResult fields + form wiring
cd pwa && pnpm i18n:check          # entry.fullRefund parity (zh = en)
# optional: pnpm --filter e2e test  # link → autofill + 全額退款 smoke
```
