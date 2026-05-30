# Quickstart — Feature 021: Advanced Summary Filters

## Prerequisites

- Local dev servers running: `wrangler dev` (backend) + `vite dev` (pwa)
- At least a few transactions with different tags, payment methods, and dates in the dev database

## Step 1 — Time navigation

1. Open the PWA summary tab
2. Confirm the old preset pills (本月/上月/近3個月…) are gone
3. Confirm a `week | month | year | 全部` tab selector is visible at the top
4. The default should be **week**, showing the current Sun–Sat window
5. Tap **◀** — confirm the window moves to the previous week and the label updates
6. Tap **▶** — confirm it returns to the current week
7. Confirm **▶** is disabled (greyed out) when on the current week
8. Switch to **month** — confirm window resets to current month label (e.g., "May 2026")
9. Tap ◀ twice — confirm you navigate to March 2026

## Step 2 — Period picker (direct jump)

1. In month mode, tap the window label (e.g., "May 2026")
2. Confirm a picker modal opens
3. Select year 2025
4. Confirm a 12-month grid appears; tap "April"
5. Confirm the summary loads April 2025 data and the modal closes
6. In week mode, tap the label → pick a year → pick a month → pick a week row → confirm summary loads that week

## Step 3 — Tag filter

1. Return to current month (tap **月** tab; the window should go to current month)
2. Confirm a filter bar appears below the nav with tag chips for tags present in the current window
3. Tap a tag chip (e.g., "lunch")
4. Confirm the grand total and transaction list update to show only lunch-tagged transactions
5. Tap the same chip again — confirm filter clears and all transactions return
6. Navigate to a different month while a tag filter is active — confirm the filter persists

## Step 4 — Payment method filter

1. Tap a payment method pill in the filter bar
2. Confirm only transactions with that payment method are shown
3. Tap a different payment method pill — confirm it switches (not adds)
4. Deselect — confirm all methods return

## Step 5 — Combined filter

1. Activate both a tag filter and a payment method filter simultaneously
2. Confirm only transactions matching **both** appear

## Step 6 — 全部 mode

1. Tap **全部** tab
2. Confirm the filter bar is hidden
3. Confirm transactions load lazily by month (existing behavior preserved)

## Step 7 — Deploy and smoke test on phone

1. `pnpm run deploy` from `backend/`
2. Open PWA on phone
3. Repeat Steps 1–3 on mobile — confirm no horizontal overflow on the nav or filter bar
