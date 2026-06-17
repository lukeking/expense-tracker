# Quickstart: Summary Subcategory Filter

## What changes

In the Summary drilldown, tapping a subcategory bar now **filters** the transaction list to that subcategory (today it only shows a tooltip), so you can see **which days** had that subcategory's spending and **how much** in total. The list is day-grouped; the header shows the subcategory's **net** total; non-selected bars get a 百葉窗 shade. One small backend change: `GET /pwa/transactions` now returns each item's `effective_amount`.

## UI mockup (sign-off before implementation)

### State S1 — major drilldown today (unchanged entry point)

```
┌────────────────────────────────────────────┐
│  ‹ Back     飲食                  NT$12,400  │   ← major + major total
├────────────────────────────────────────────┤
│  早餐  ████████████████████████  NT$5,200    │   ← bars (tap = tooltip only, today)
│  午餐  ██████████████            NT$3,800    │
│  晚餐  █████████                 NT$2,600    │
│  其他  ██                        NT$  800    │
├────────────────────────────────────────────┤
│  TRANSACTIONS                                │
│  2026-06-15            NT$1,240        ▼     │   ← ALL of 飲食's transactions
│  2026-06-14            NT$  980        ▼     │
│  …                                           │
└────────────────────────────────────────────┘
```

### State S2 — after tapping the 午餐 bar (new)

```
┌────────────────────────────────────────────┐
│  ‹ Back   飲食 › 午餐    NT$3,800   [✕ All] │   ← breadcrumb + NET sub total + clear control
├────────────────────────────────────────────┤
│  早餐  ░░░░░░░░░░░░░░░░░░░░░░░░  NT$5,200    │   ← 百葉窗 shade (animates down)
│  午餐  ██████████████  NT$3,800   ◀ selected │   ← shows through (not repainted)
│  晚餐  ░░░░░░░░░                 NT$2,600    │   ← 百葉窗 shade
│  其他  ░░                        NT$  800    │   ← 百葉窗 shade
├────────────────────────────────────────────┤
│  TRANSACTIONS                                │
│  2026-06-15            NT$  420        ▼     │   ← days with 飲食:午餐 spend; subtotal = NET 午餐
│  2026-06-13            NT$  380        ▼     │   ← (420 + 380 + … = 3,800 header total)
└────────────────────────────────────────────┘
```

Resolved decisions:
- **Net total**: `NT$3,800` is the sum of matching items' `effective_amount` (discounts already netted); day subtotals sum to it.
- **百葉窗 shade**: non-selected bars get a semi-transparent overlay that animates down on select / retracts on clear (lightweight CSS transition; not literal slats). The selected bar shows through — no accent repaint.
- **Clear**: tap the selected `午餐` bar again **or** tap `[✕ All]` → back to S1.
- **`[✕ All]` label** is i18n'd (`zh`: 全部 / `en`: All), in both catalogs; default affordance = the labelled chip shown.
- Selecting a different bar swaps the selection (no stacking).

## Manual verification

Run the app (WSL2 ports per project convention):

```
cd pwa && pnpm dev          # Vite on :5300
```

1. Summary → tap a major slice with ≥2 subcategories → confirm S1 (bars + full major list).
2. Tap a subcategory bar → list narrows + **day-groups** to that subcategory; header shows `Major › Sub` + the **net** sub total; non-selected bars get the shade.
3. Confirm reconciliation: the day subtotals sum to the header total; for item-tagged spend it matches the bar.
4. Tap a different bar → list + header switch; only one bar shows through.
5. Tap the active bar again → restored to S1. Repeat using the clear control.
6. With a tag or payment-method filter active, repeat (2) → subcategory filter narrows within that filter.
7. Tap the `其他` bar → list shows the bare-major (no specific subcategory) transactions; amounts are net.
8. Pick a subcategory containing a discounted item → confirm its amount is the **net** (`effective_amount`), not gross.
9. Change time base / navigate period while filtered → selection resets (back to S0/S1 per existing behavior).

## Automated checks

```
cd backend && pnpm test              # worker tests incl. /pwa/transactions returns effective_amount
cd pwa && pnpm exec tsc -b           # types incl. i18n key parity + new TxItem.effective_amount
cd pwa && pnpm i18n:check            # no residual hardcoded CJK for new labels
# E2E (full stack per STATE.md): backend supabase up + dev vars, then:
cd e2e && pnpm test                  # incl. the new drilldown→subcategory smoke
```
