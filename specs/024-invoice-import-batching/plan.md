# Implementation Plan: Invoice Import Batching (subrequest-safe matching)

**Branch**: `024-invoice-import-batching` | **Date**: 2026-06-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/024-invoice-import-batching/spec.md`

## Summary

The invoice import pipeline currently issues several Supabase queries **per invoice** (a transactions match query + a discount-adjustments query + a forex fallback query + 2–3 writes per match). Total subrequests therefore scale with invoice count and breach Cloudflare Workers' per-invocation subrequest cap — production import fails with `Too many subrequests`.

Fix: turn the per-invoice query loop into a **bulk pre-fetch + in-memory match + bulk write** pipeline.
- **Reads**: one query for all unmatched expense transactions across the union date window, one for their discount adjustments, one for the matched transactions' existing items. Constant, not per-invoice.
- **Match**: a pure in-memory function reproduces the exact `findMatchingExpenseTransaction` + `findForexCandidateTransactions` semantics (±2-day exact/discount, ±7-day ±5% forex), tracking transactions consumed during the run so none links twice.
- **Writes**: one multi-row invoice insert, one transactions upsert (built from the pre-fetched full rows), one items insert. Constant, not per-match.
- **Guard**: if the candidate read returns more than the data store's max page size, abort before matching (no silent truncation).

Behavior is preserved exactly; the existing backend test suite is the regression oracle. No API contract change, no schema/migration change.

## Technical Context

**Language/Version**: TypeScript (ES2022), Node toolchain via pnpm
**Primary Dependencies**: Hono (router), `@supabase/supabase-js` (PostgREST client), Vitest + `@cloudflare/vitest-pool-workers`
**Storage**: Supabase Postgres (tables: `transactions`, `transaction_items`, `transaction_adjustments`, `invoices`, `import_runs`)
**Testing**: Vitest workers pool (Miniflare); pipeline tests use an in-memory fake Supabase that runs the real pipeline end-to-end (`backend/tests/services/invoice-matcher.test.ts`)
**Target Platform**: Cloudflare Workers (single isolate per request)
**Project Type**: Web app — backend Worker + PWA frontend (this feature is backend-only)
**Performance Goals**: One import invocation ≤ ~50 subrequests for any CSV up to the 1000-row cap (constant w.r.t. invoice count)
**Constraints**: CF Workers per-invocation subrequest cap (≈50 free / 1000 paid — design to ~50); 128 MB memory; Supabase single-response row limit (~1000)
**Scale/Scope**: Single user; monthly import cadence; up to 1000 invoices/import; in-window candidate transactions normally in the tens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First** — Net reduction in moving parts: removes the per-invoice query loop, adds a handful of bulk helpers + one pure matcher. No new component, no new abstraction layer, no DB objects. Truncation handled by a loud guard rather than speculative paging (explicitly chosen in clarification).
- [x] **II. Offline-First on Android** — N/A; no Android code touched.
- [x] **III. Serverless Boundary Compliance** — This is the principle the feature directly serves: it brings the import invocation back within Workers' subrequest budget. No WebSocket/gateway; import remains a single synchronous HTTP handler (already within wall-time via existing parse limits; bulk ops are fewer/faster round-trips than today).
- [x] **IV. Automation Over Manual Input** — Matching outcomes are unchanged (FR-003): unambiguous auto-link, ambiguous held for confirmation. The fix restores the automated import that is currently broken.
- [x] **V. Security at System Boundaries** — No change to auth, secrets, or data-access boundary; all DB access stays inside the Worker via the existing Supabase client.

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/024-invoice-import-batching/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (window math, truncation detection, upsert shape, ambiguous endpoint scope)
├── data-model.md        # Phase 1 — in-memory structures + touched tables/columns (no schema change)
├── quickstart.md        # Phase 1 — how to validate (test suite + real import)
├── contracts/
│   └── internal-api.md  # Phase 1 — new internal function signatures; confirms HTTP/API contract unchanged
└── tasks.md             # Phase 2 — /speckit-tasks output
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── db/
│   │   └── queries.ts            # ADD bulk read/write helpers; KEEP findMatchingExpenseTransaction/findForexCandidateTransactions (still used by GET /import/ambiguous)
│   ├── services/
│   │   └── invoice-matcher.ts    # ADD pure in-memory matchers; REWRITE runImportPipeline to pre-fetch + match + bulk-write
│   └── handlers/
│       └── pwa.ts                # POST /import unchanged (calls runImportPipeline). GET /import/ambiguous: see research decision on scope.
└── tests/
    ├── services/invoice-matcher.test.ts   # extend: subrequest-shape + behavior-parity cases; extend fake Supabase (upsert, limit/range)
    └── db/queries.test.ts                  # add coverage for new bulk helpers + truncation guard
```

**Structure Decision**: Existing web-app layout. All changes land in `backend/`. The PWA is untouched (no API contract change). The seam is `runImportPipeline` (rewritten internals, same signature) plus new helpers in `queries.ts` and a pure matcher in `invoice-matcher.ts`.

## Implementation Approach

### 1. Pure in-memory matcher (`invoice-matcher.ts`)

Extract the matching rules so they run against pre-fetched arrays, not the DB:

```ts
// ±2-day window, amount == net OR amount + Σdiscount == net; excludes consumed txs
selectExactDiscountCandidates(netAmount, invoiceDate, candidates, discountByTxId, consumedTxIds): Transaction[]
// ±7-day window, floor(net*0.95)..ceil(net*1.05); excludes consumed txs
selectForexCandidates(netAmount, invoiceDate, candidates, consumedTxIds): Transaction[]
```

These mirror `findMatchingExpenseTransaction` / `findForexCandidateTransactions` exactly (same window/amount math), but as pure functions. They become the single source of truth that the DB query (kept for the ambiguous endpoint) and the bulk pipeline both encode.

### 2. Bulk reads (`queries.ts`)

```ts
// One query; expense + matched_invoice_id IS NULL + transaction_at in [start,end].
// No per-invoice amount bound (each invoice differs) → amount filtering happens in memory.
// Truncation guard: request limit = MAX_PAGE+1; if returned > MAX_PAGE, throw (FR-012).
fetchImportCandidateTransactions(supabase, windowStartISO, windowEndISO): Transaction[]
// One query; kind='discount' for the relevant candidate tx ids; summed into a Map.
fetchDiscountSumsByTransaction(supabase, txIds): Map<string, number>
```

`getTransactionItemsByTransactionIds` already exists — reuse it to batch the "fill vs keep" decision for matched transactions.

### 3. Rewrite `runImportPipeline`

1. Dedup by invoice_number (unchanged: `findExistingInvoiceNumbers`, 1 query).
2. Compute union window: `min(invoice_date) − 7d` … `max(invoice_date) + 7d` (covers both the ±2-day exact and ±7-day forex windows in one fetch).
3. `fetchImportCandidateTransactions` (1 query, with truncation guard).
4. `fetchDiscountSumsByTransaction` for candidates whose amount is below the batch's max net (1 query).
5. Loop invoices **in input order**, matching in memory via the pure functions, maintaining a `consumedTxIds` Set (an exact-match of length 1 consumes its tx; ambiguous consumes nothing) — preserves FR-005 (no double-link) without re-querying.
6. Classify into `matched[]` / `ambiguous[]` / `skippedUnmatched[]`; `skipped_unmatched` persists no row (FR-007).
7. Batch-read existing items for matched tx ids (1 query) → decide `filled` vs `kept` per match.
8. Bulk writes: insert all invoice rows (matched + ambiguous) and read back ids (1) → upsert all matched transactions' enrichment from pre-fetched full rows (1) → insert all fill items with `source_invoice_id` (1).
9. Counters + summary identical in shape to today.

Net subrequests ≈ dedup(1) + candidates(1) + discounts(1) + items(1) + invoices(1) + tx-upsert(1) + items-insert(1) + createImportRun(1) + updateImportRun(1) ≈ **~9, constant** in invoice count.

### 4. Write ordering / partial-failure

Order: invoices insert → transaction enrichment upsert → item insert. If the invocation dies mid-sequence, invoice rows exist (persisted) but a re-import dedups them; transactions left un-enriched are an acceptable, recoverable state matching today's "status flip last" intent (research Decision 5 of 022). No DB transaction introduced (Supabase JS has none; constitution Simplicity-First).

### 5. `GET /import/ambiguous` (decided in research)

Same N+1 pattern, lower blast radius (only ambiguous invoices, usually few). **In scope** to refactor with the same bulk pre-fetch + the new pure matcher, because FR-002 ("candidate-lookup round-trips must not scale with invoice count") applies to it equally and it shares the exact functions. Kept as a clearly separable task so it can be dropped if the user prefers to defer.

## Complexity Tracking

No constitution violations; table intentionally omitted.
