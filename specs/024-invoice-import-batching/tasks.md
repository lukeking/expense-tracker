---
description: "Task list for Invoice Import Batching (subrequest-safe matching)"
---

# Tasks: Invoice Import Batching (subrequest-safe matching)

**Input**: Design documents from `/specs/024-invoice-import-batching/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-api.md, quickstart.md

**Tests**: Included. The spec's SC-003 + quickstart explicitly require behavior-parity and new edge-case tests, and the constitution mandates test coverage for matching edge cases. The existing suite is the regression oracle.

**Note on story mapping**: US1 ("import completes within budget") and US2 ("outcomes identical") are inseparable for the import path — one pipeline rewrite satisfies both. US1 tasks = the bulk read/write + budget + truncation work; US2 tasks = the parity/edge-case tests that lock behavior preservation. The shared pure matcher lives in Foundational because both stories depend on it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 (Polish/Setup/Foundational have no story label)

## Path Conventions

Web app — all changes in `backend/`. PWA untouched (no API/contract change, FR-010).

---

## Phase 1: Setup

**Purpose**: Establish the regression baseline and ready the test harness.

- [x] T001 Run `cd backend && pnpm test` and confirm the suite is green — this is the behavior-parity baseline (SC-003) the refactor must hold.
- [x] T002 Extend the in-memory fake Supabase in `backend/tests/services/invoice-matcher.test.ts` to support `.upsert()` (insert-or-update by `id`), explicit `.limit()`/`.range()` (for truncation), and per-table round-trip counters (for subrequest-shape assertions). Keep the existing `calls.insertTransactions` counter.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure matcher and bulk DB helpers that the pipeline rewrite (and the ambiguous endpoint) build on.

**⚠️ CRITICAL**: Phase 3 cannot begin until this phase is complete.

- [x] T003 [P] Add pure, I/O-free matchers to `backend/src/services/invoice-matcher.ts`: `selectExactDiscountCandidates(netAmount, invoiceDate, candidates, discountByTxId, consumedTxIds)` (±2-day; `amount == net` OR `amount + Σdiscount == net`; excludes consumed) and `selectForexCandidates(netAmount, invoiceDate, candidates, consumedTxIds)` (±7-day; `floor(net*0.95)..ceil(net*1.05)`; excludes consumed). Mirror the exact window/amount math of the current `findMatchingExpenseTransaction` / `findForexCandidateTransactions`.
- [x] T004 [P] Add `fetchImportCandidateTransactions(supabase, windowStartISO, windowEndISO)` to `backend/src/db/queries.ts`: one query for `expense` + `matched_invoice_id IS NULL` + `transaction_at` in window, requesting `MAX_PAGE + 1` (MAX_PAGE = 1000) rows; throw a clear truncation error if more than `MAX_PAGE` rows return (FR-012). Define the `MAX_PAGE` constant here.
- [x] T005 Add `fetchDiscountSumsByTransaction(supabase, txIds)` to `backend/src/db/queries.ts`: one query for `kind='discount'` adjustments of the given tx ids, summed into a `Map<string, number>`. (Same file as T004 → sequential.)
- [x] T006 Add bulk write helpers to `backend/src/db/queries.ts`: `bulkInsertInvoices(rows)` (one multi-row insert, returns rows with ids in input order), `bulkEnrichTransactions(rows)` (one `upsert` onConflict `id`, payload = full pre-fetched row + `{is_matched, invoice_number, seller_name, seller_tax_id, matched_invoice_id}`), and a `bulkInsertTransactionItems(rows)` thin wrapper (one multi-row insert with `source_invoice_id`). (Same file → sequential after T005.)

**Checkpoint**: Pure matcher + bulk read/write helpers exist and type-check.

---

## Phase 3: User Story 1 — Import completes regardless of CSV size (Priority: P1) 🎯 MVP

**Goal**: Replace the per-invoice query loop with bulk pre-fetch + in-memory match + bulk writes, so one import stays within the ~50 subrequest budget for any CSV up to 1000 rows.

**Independent Test**: A multi-invoice import performs a constant, small number of DB round-trips (no per-invoice growth), completes without a subrequest error, and the summary accounts for 100% of invoices.

- [x] T007 [US1] Rewrite `runImportPipeline` in `backend/src/services/invoice-matcher.ts` (keep its signature + `PipelineCounters` return shape): dedup via `findExistingInvoiceNumbers` → compute union window `[min(date)−7d, max(date)+7d]` → `fetchImportCandidateTransactions` (guarded) → `fetchDiscountSumsByTransaction` (for candidates below the batch max net) → loop invoices in input order, matching in memory via the T003 functions with a `consumedTxIds` Set (length-1 exact/discount match consumes its tx; ambiguous/skipped consume nothing) → classify matched/ambiguous/skipped_unmatched (skipped persists no row, FR-007) → batch-read existing items for matched txs (`getTransactionItemsByTransactionIds`) to decide filled-vs-kept → bulk-write: `bulkInsertInvoices` (matched + ambiguous, read ids back) then `bulkEnrichTransactions` then `bulkInsertTransactionItems` (fills only). Remove the per-invoice `findMatchingExpenseTransaction`/`enrichTransaction`/`insertInvoice`/`applyInvoiceItems` calls from the loop.
- [x] T008 [US1] Add a truncation-guard test in `backend/tests/services/invoice-matcher.test.ts`: seed more than `MAX_PAGE` in-window candidates → import aborts with the clear error and performs **no** writes (no invoice rows, no enrichment) (FR-012).
- [x] T009 [US1] Add a subrequest-shape test in `backend/tests/services/invoice-matcher.test.ts`: an import of N invoices (e.g. N=30) performs a constant, small number of DB round-trips independent of N (assert via the T002 counters), and `calls.insertTransactions === 0` (enrichment-only).

**Checkpoint**: Import path is subrequest-safe and the bug (SC-001) is fixed.

---

## Phase 4: User Story 2 — Matching results are unchanged (Priority: P1)

**Goal**: Prove and lock that the rewrite produces identical outcomes to the per-invoice implementation.

**Independent Test**: The full existing suite passes unchanged, plus the new edge-case tests below.

- [x] T010 [US2] Parity tests in `backend/tests/services/invoice-matcher.test.ts`: exact same-day amount → `matched_exact`; within ±2 days → `matched_near`; ≥2 in-window candidates → `ambiguous` (no auto-link); 0 exact + forex within ±7 days ±5% → `ambiguous`; 0 candidates → `skipped_unmatched` with no persisted invoice row. (Same test file → sequential.)
- [x] T011 [US2] Discount-gross test: an invoice whose net equals a below-net transaction's `amount + Σdiscount` auto-links `near`; a non-discounted transaction is unaffected; fees/refunds never raise the gross.
- [x] T012 [US2] Consumed-set test (SC-005): two invoices in one import that could each match the same single transaction → exactly one links, the other falls through to its next outcome (forex/ambiguous or skipped), matching prior sequential behavior.

**Checkpoint**: Behavior preservation (SC-003) is locked by tests; US1 + US2 both satisfied.

---

## Phase 5: Ambiguous-list endpoint (extension — research Decision 6)

**Goal**: Apply the same bulk pre-fetch + pure matcher to `GET /import/ambiguous` so the post-import review screen also stays within budget (FR-002). Separable — drop this phase if deferring.

- [x] T013 [US1] Refactor `GET /pwa/import/ambiguous` in `backend/src/handlers/pwa.ts`: fetch ambiguous invoices, compute the union window, `fetchImportCandidateTransactions` once, `fetchDiscountSumsByTransaction` once, batch candidate items via `getTransactionItemsByTransactionIds`, then derive each invoice's candidates in memory via the T003 matchers. Preserve the exact response shape (`{ ambiguous: [{ …, candidate_source, candidates: [{…, items}] }] }`).
- [x] T014 [US1] Test `GET /import/ambiguous` returns the same entry/candidate shape with bounded (non-per-invoice) round-trips, and that candidates linked since import drop out (the `matched_invoice_id IS NULL` filter still holds via the candidate fetch).

**Checkpoint**: Both import-flow surfaces (import + ambiguous review) are subrequest-safe.

---

## Phase 6: Polish & Validation

- [x] T015 [P] Run `cd backend && pnpm tsc --noEmit` — clean. Remove `findMatchingExpenseTransaction` / `findForexCandidateTransactions` only if T013 left them with no remaining callers; otherwise keep.
- [x] T016 Run `cd backend && pnpm test` — full suite green (the SC-003 parity oracle).
- [ ] T017 Execute `quickstart.md`: re-upload the CSV that previously failed and confirm it completes with a full summary and no subrequest error (SC-001/SC-004). Backend deploy (`pnpm run deploy`) is the user's call.

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T006)** → **US1 (T007–T009)** → **US2 (T010–T012)** → **Ambiguous extension (T013–T014)** → **Polish (T015–T017)**.
- T003 (matcher file) runs parallel to T004 (queries file). T004→T005→T006 are sequential (same file `queries.ts`).
- T007 depends on T003–T006. T008/T009 depend on T007. T010–T012 depend on T007. T013–T014 depend on T003–T006 (+T002 harness).
- US2 tests (T010–T012) and US1 tests (T008–T009) all live in `invoice-matcher.test.ts` → write sequentially within that file.

## Parallel Opportunities

- T003 ∥ T004 (different files).
- T015 (`tsc`) can run alongside writing T017's validation notes.

## Implementation Strategy

**MVP = Phases 1–4** (Setup → Foundational → US1 → US2): fixes the production failure *and* proves behavior is unchanged. Stop and validate here — this is independently deployable.

**Phase 5** is a high-value, low-cost extension (same pattern, same functions) that prevents the post-import ambiguous-review screen from hitting the same cap; include unless explicitly deferring.

## Notes

- No migration, no API/contract change, no frontend change (FR-010).
- Commit after each logical group. The full `pnpm test` pass (T016) is the non-negotiable gate before deploy.
