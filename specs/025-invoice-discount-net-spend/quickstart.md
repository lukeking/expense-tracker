# Quickstart — Validate feature 025

Discount-aware net spend for itemized transactions. No schema migration; backend + one-time script only.

## Prerequisites

- `cd backend && pnpm install` (already present in dev).
- Tests run against Miniflare; no `.dev.vars` needed for the suite.

## 1. Automated tests (primary oracle)

```bash
cd backend
pnpm run typecheck
pnpm run lint
pnpm run test
```

Expect green, including the new cases:
- `summary.test.ts` — aggregators count `effective_amount` for discounted items; non-discounted unchanged (SC-003), Σ category ≤ grand total (SC-002).
- `queries.test.ts` — `computeEffectiveShares` proportional split + remainder-to-largest + null exclusion (SC-005); `getTransactionsForPeriod` selects `effective_amount`.
- `invoice-matcher.test.ts` — import fill stamps net `effective_amount` summing to paid; non-discounted fill ⇒ `effective_amount == amount`; subrequest shape unchanged (C4).
- `pwa-import.test.ts` — `resolve` fill stamps `effective_amount`; `manual-link` still does; `PUT /expense` edit stays reconciled (FR-008).

## 2. Manual end-to-end (dev DB)

**US1 (manual discount, self-corrects):**
1. Add an expense: amount **450**, items 洗髮精 **300** (日用), 零食 **200** (飲食), discount adjustment **−50**.
2. Open Summary for that period → 日用 + 飲食 contribute **450** total (not 500); category totals sum to the grand total.

**US2 (invoice fill):**
1. Import (or manually link) a discounted invoice (gross 1000 / discount 100 / net 900, items A:600 B:400) onto a transaction that paid **900** and had no items.
2. Summary → A + B contribute **900** total, not 1000.
3. Repeat with a non-discounted invoice → numbers unchanged.

## 3. Historical backfill (US3)

```bash
cd backend
pnpm tsx scripts/backfill-effective-amounts.ts --dry-run   # prints before→after per tx, writes nothing
pnpm tsx scripts/backfill-effective-amounts.ts --apply     # corrects historical invoice-filled discounted txs
pnpm tsx scripts/backfill-effective-amounts.ts --apply     # idempotent: reports 0 changes
```

Then re-open a previously-affected past month → category totals now reconcile to the grand total (SC-004).

## 4. Acceptance checklist

- [ ] SC-001 — discounted tx (manual or filled): items contribute exactly the paid amount.
- [ ] SC-002 — every period: Σ category totals ≤ grand total.
- [ ] SC-003 — non-discounted: summary numbers byte-for-byte unchanged.
- [ ] SC-004 — after backfill, affected past periods reconcile.
- [ ] SC-005 — per-tx rounding error ≤ 1.

## Deploy notes

- **No migration.** Redeploy the backend (`cd backend && pnpm run deploy`) so the corrected summary read + invoice-fill recompute go live.
- Run the backfill `--apply` once against **prod** after deploy (one-time, like prior data scripts). PWA auto-deploys on merge; no PWA change.
