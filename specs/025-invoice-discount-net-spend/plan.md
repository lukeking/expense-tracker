# Implementation Plan: Discount-aware net spend for itemized transactions

**Branch**: `025-invoice-discount-net-spend` | **Date**: 2026-06-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/025-invoice-discount-net-spend/spec.md`

## Summary

Category/subcategory summaries overcount discounted spend. Two independent causes (see spec Root Cause):

1. **Summaries never read the stored net per-item value.** `getTransactionsForPeriod` selects `transaction_items(amount, tags)` only, so `aggregateByCategory`/`aggregateBySubcategory` fall back to face `amount`. This overcounts **any** itemized transaction whose items' face total exceeds the paid amount — including manually-entered expenses with a discount adjustment (their `effective_amount` is already computed and stored).
2. **Invoice fills never compute the net per-item value.** Two fill sites — `POST /import/resolve` and the bulk `runImportPipeline` — insert the invoice's (gross) line items without recomputing `effective_amount`, so those items have `effective_amount = NULL` and count gross.

Fix, mapped to the spec's user stories:
- **US1** — add `effective_amount` to the `getTransactionsForPeriod` select; the aggregators already prefer `effective_amount ?? amount`, so manual discounted transactions self-correct immediately.
- **US2** — recompute `effective_amount` at the two invoice-fill sites: the single-tx `resolve` path reuses the existing `computeAndWriteEffectiveAmounts`; the bulk import path computes shares **in memory** and writes `effective_amount` in the existing bulk insert, preserving feature-024's constant-subrequest budget. (`manual-link` already recomputes — verify only.)
- **US3** — a one-time backfill script recomputes `effective_amount` for transactions already filled from discounted invoices.

Attribution is **proportional to face value** (exactly what `computeAndWriteEffectiveAmounts` already does), so manual and invoice paths stay identical. **No schema/migration** — `effective_amount` already exists (migrations 015–017). No API contract change.

## Technical Context

**Language/Version**: TypeScript (ES2022), Node toolchain via pnpm
**Primary Dependencies**: Hono (router), `@supabase/supabase-js` (PostgREST client), Vitest + `@cloudflare/vitest-pool-workers`; PWA: React + Recharts (read-only consumer of summary data)
**Storage**: Supabase Postgres (`transactions`, `transaction_items` incl. existing `effective_amount`, `transaction_adjustments`, `invoices`)
**Testing**: Vitest workers pool (Miniflare); pure-function unit tests for aggregation + share math; in-memory fake Supabase for handler/pipeline paths
**Target Platform**: Cloudflare Workers (single isolate per request) + static PWA
**Project Type**: Web app — backend Worker + PWA frontend (this feature is backend + a one-time script; PWA needs no code change)
**Performance Goals**: Import invocation stays at feature-024's ~constant subrequest count (no per-matched-tx round-trip added)
**Constraints**: CF Workers subrequest cap (design to ~50); 128 MB; backfill is an offline one-time script (not in a request path)
**Scale/Scope**: Single user; hundreds of transactions/month; backfill touches at most all historical itemized transactions

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First** — Reuses the existing proportional `computeAndWriteEffectiveAmounts` logic instead of inventing a new discount model; the chosen "spend-correction only" (FR-007) avoids adding an editable discount line/new write paths. One new pure helper (bulk share computation) + one select change + one backfill script. No new component or abstraction.
- [x] **II. Offline-First on Android** — N/A; no Android code touched.
- [x] **III. Serverless Boundary Compliance** — The bulk import path computes shares in memory and writes them in the existing bulk insert, adding **zero** per-tx subrequests (preserves 024's budget). The single-tx resolve path adds one read+writes already bounded by item count. Backfill runs **outside** the Worker as a local script.
- [x] **IV. Automation Over Manual Input** — No change to matching/automation behaviour; this only corrects how already-captured spend is aggregated. No new manual step.
- [x] **V. Security at System Boundaries** — No auth/secret/boundary change. The backfill script uses the same server-side Supabase access pattern as existing `scripts/` utilities (service role never leaves the host).

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/025-invoice-discount-net-spend/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (attribution, bulk-vs-per-tx, backfill scope, no-schema-change)
├── data-model.md        # Phase 1 — touched tables/columns (no DDL) + the net-share invariant
├── quickstart.md        # Phase 1 — how to validate (tests + manual + backfill dry-run)
├── contracts/
│   └── internal-api.md  # Phase 1 — changed/added internal signatures; confirms HTTP/API unchanged
└── tasks.md             # Phase 2 — /speckit-tasks output
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── db/
│   │   └── queries.ts            # CHANGE getTransactionsForPeriod select (+effective_amount);
│   │                             #   ADD effective_amount to bulkInsertTransactionItems row shape;
│   │                             #   EXTRACT pure proportional-share helper (shared w/ computeAndWriteEffectiveAmounts)
│   ├── services/
│   │   └── invoice-matcher.ts    # runImportPipeline: compute fill-item effective_amount in memory before bulk insert
│   └── handlers/
│       └── pwa.ts                # POST /import/resolve: recompute effective_amount after applyInvoiceItems (single tx)
├── scripts/
│   └── backfill-effective-amounts.ts   # NEW one-time backfill (US3)
└── tests/
    ├── services/summary.test.ts        # aggregators honour effective_amount over amount (discount cases)
    ├── services/invoice-matcher.test.ts# import fill stamps net effective_amount; non-discounted unchanged
    ├── db/queries.test.ts              # pure share helper: proportional split + remainder; select shape
    └── handlers/pwa-import.test.ts     # resolve path stamps effective_amount

pwa/   # no code change — Recharts summary already renders whatever the API returns
```

**Structure Decision**: Existing web-app layout. All runtime changes are in `backend/`; the PWA is untouched (the `/summary` response shape is unchanged — only the numbers become correct). The historical correction (US3) is a standalone `scripts/` utility, consistent with existing one-off scripts (e.g. `migrate-legacy.ts`).

## Implementation Approach

### US1 — summaries read the stored net value (P1, smallest)

- `getTransactionsForPeriod` (`queries.ts`): add `effective_amount` to the `transaction_items(...)` select.
- `aggregateByCategory`/`aggregateBySubcategory` already use `item.effective_amount ?? item.amount` — no change.
- Net effect: every transaction that already has `effective_amount` (all manually-entered itemized expenses, discounted or not) is now summarised at net. Non-discounted are unchanged (`effective_amount == amount`, or null→fallback to equal `amount`).

### US2 — invoice fills compute the net value (P2)

Two fill sites currently skip the recompute:

1. **`POST /import/resolve`** (`pwa.ts`, single transaction): after `applyInvoiceItems`, call the existing `computeAndWriteEffectiveAmounts(supabase, tx.id, tx.amount)`. Cheap (one tx).
2. **`runImportPipeline`** (`invoice-matcher.ts`, bulk): a per-tx DB recompute would reintroduce per-match subrequests (breaks 024). Instead compute shares **in memory** for each match's fill items (we already hold the matched tx's paid `amount` and the items) using a pure helper, and write `effective_amount` as part of the existing single bulk `bulkInsertTransactionItems` call.

To keep one source of truth for the proportional rule, extract the share math (`floor(amount × paid / itemsTotal)` + remainder-to-largest) into a pure helper used by **both** `computeAndWriteEffectiveAmounts` (per-tx DB writer) and the bulk pipeline.

`manual-link` already calls `computeAndWriteEffectiveAmounts(tx.id, tx.amount)` after appending items — covered; add a regression test only.

### US3 — backfill historical invoice-filled records (P3)

`scripts/backfill-effective-amounts.ts`: select transactions that have items sourced from an invoice (`transaction_items.source_invoice_id IS NOT NULL`) whose items' face total ≠ `transactions.amount` (i.e. discounted) and whose `effective_amount` is missing/inconsistent; recompute via `computeAndWriteEffectiveAmounts(tx.id, tx.amount)`. Idempotent (re-running is a no-op); non-discounted rows are left unchanged. A dry-run flag prints the diff before writing. Run once at deploy, like prior migrations/scripts.

### Edge cases (from spec)

- **Rounding** (FR-003/009): the shared helper already floors shares and adds the remainder to the largest item, so items sum exactly to paid (≤1-unit error) — covered by reusing it.
- **Null-amount / uncategorised items**: the helper only apportions `amount != null` items; the aggregators' existing `其他`-remainder fallback is unaffected.
- **Edit after fill** (FR-008): `PUT /expense` already recomputes `effective_amount` against the edited `amount` — verify with a test.

## Complexity Tracking

No constitution violations; table intentionally omitted.
