# Quickstart — Validate Invoice Import Batching

Backend-only change; no migration, no frontend change, no API contract change.

## 1. Behavior parity (primary gate)

```bash
cd backend
pnpm test            # full Vitest suite — the regression oracle
```

Expect: the entire existing suite passes **unchanged** (SC-003). The matching-outcome assertions in `tests/services/invoice-matcher.test.ts` are the proof that batching changed nothing observable.

New tests to expect green:
- consumed-set: two invoices that could match the same single transaction → only one links, the other falls through (SC-005).
- discount-gross: an invoice net matches `amount + Σdiscount` of a below-net transaction → auto-links `near`.
- truncation guard: a seeded candidate set larger than `MAX_PAGE` → import aborts with a clear error, no partial writes (FR-012).
- subrequest shape: a multi-invoice import performs a constant, small number of DB round-trips (no per-invoice growth) — asserted via fake-Supabase call counters.

## 2. Type + build

```bash
cd backend && pnpm tsc --noEmit
```

(PWA build unaffected; no frontend change.)

## 3. Real import (the production repro)

1. `cd backend && pnpm run deploy`
2. In the PWA Import screen, upload the CSV that previously failed with `Too many subrequests` (e.g. `5261954_20260606113444.csv`).
3. Expect: import completes and the summary accounts for 100% of invoices (matched + ambiguous + skipped) — **no** subrequest error (SC-001, SC-004).
4. Open 待手動確認 (ambiguous list): it loads without a subrequest error even with several ambiguous invoices (if the ambiguous-endpoint task is included).
5. Spot-check: the matched/ambiguous/skipped breakdown equals what you'd expect from the same file pre-change (SC-003).

## Rollback

Pure code change on a feature branch — revert the branch / redeploy the previous backend build. No data migration to undo.
