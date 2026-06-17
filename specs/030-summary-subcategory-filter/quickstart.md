# Quickstart: Summary Subcategory Filter

## What changes (one screen)

In the Summary drilldown, tapping a subcategory bar now **filters** the transaction list to that subcategory (today it only shows a tooltip). Two ways to clear; breadcrumb header shows the subcategory total.

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
│  ‹ Back   飲食 › 午餐    NT$3,800   [✕ All] │   ← breadcrumb + SUB total + clear control
├────────────────────────────────────────────┤
│  早餐  ████████████████████████  NT$5,200    │   ← dimmed
│  午餐  ██████████████  NT$3,800   ◀ selected │   ← highlighted (accent fill)
│  晚餐  █████████                 NT$2,600    │   ← dimmed
│  其他  ██                        NT$  800    │
├────────────────────────────────────────────┤
│  TRANSACTIONS                                │
│  2026-06-15            NT$  420        ▼     │   ← ONLY 飲食:午餐 transactions
│  2026-06-13            NT$  380        ▼     │
└────────────────────────────────────────────┘
```

- **Clear** by either: tapping the highlighted `午餐` bar again, **or** tapping `[✕ All]` → back to S1.
- The `[✕ All]` control text is i18n'd (`zh`: e.g. 全部 / `en`: All); exact label finalized in implementation, both catalogs.
- Selecting a different bar swaps the selection (no stacking).

> Confirm this layout before implementation. Open question for sign-off: the clear-control affordance — `[✕ All]` chip in the header (shown above) vs. a plain `✕` next to the breadcrumb. Default = the labelled chip.

## Manual verification

Run the app (WSL2 ports per project convention):

```
cd pwa && pnpm dev          # Vite on :5300
```

1. Summary → tap a major slice with ≥2 subcategories → confirm S1 (bars + full major list).
2. Tap a subcategory bar → list narrows to that subcategory; header shows `Major › Sub` + the sub total (equal to the bar); bar highlighted.
3. Tap a different bar → list + header switch; only one bar highlighted.
4. Tap the active bar again → restored to S1. Repeat using the clear control.
5. With a tag or payment-method filter active, repeat (2) → subcategory filter narrows within that filter.
6. Tap the `其他` bar → list shows the bare-major (no specific subcategory) transactions.
7. Change time base / navigate period while filtered → selection resets (back to S0/S1 per existing behavior).

## Automated checks

```
cd pwa && pnpm exec tsc -b           # types incl. i18n key parity
cd pwa && pnpm i18n:check            # no residual hardcoded CJK for new labels
# E2E (full stack per STATE.md): backend supabase up + dev vars, then:
cd e2e && pnpm test                  # incl. the new drilldown→subcategory smoke
```
