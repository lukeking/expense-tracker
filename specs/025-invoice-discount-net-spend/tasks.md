---
description: "Task list for feature 025 — discount-aware net spend for itemized transactions"
---

# Tasks: Discount-aware net spend for itemized transactions

**Input**: Design documents from `/specs/025-invoice-discount-net-spend/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-api.md, quickstart.md

**Tests**: Included — the project constitution mandates Vitest coverage for handlers/business logic and the quickstart names the test suite as the primary oracle.

**Organization**: Grouped by user story (US1=P1, US2=P2, US3=P3), each independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3
- Paths are repo-relative.

## Path Conventions

Web app: backend Worker at `backend/src`, tests at `backend/tests`, one-off scripts at `backend/scripts`. PWA untouched.

---

## Phase 1: Setup

- [ ] T001 Confirm baseline is green before changes: `cd backend && pnpm run typecheck && pnpm run lint && pnpm run test` (expect 275 passing).

---

## Phase 2: Foundational (shared by US2 + US3)

**Purpose**: One source of truth for the proportional net-share rule. US1 is independent of this phase and may proceed in parallel.

- [ ] T002 [P] Add unit tests for the pure share helper in `backend/tests/db/queries.test.ts`: proportional split `floor(amount × paid / Σamount)`, remainder added to the largest-amount item, `amount == null` items excluded, and `Σ shares == paidTotal` (SC-005, contract C5).
- [ ] T003 Extract `computeEffectiveShares(items: {id; amount: number|null}[], paidTotal: number): Map<string, number>` in `backend/src/db/queries.ts`, and refactor `computeAndWriteEffectiveAmounts` to fetch → `computeEffectiveShares` → write (no behaviour change; existing callers and tests stay green).

**Checkpoint**: shared share-math available; existing effective_amount behaviour unchanged.

---

## Phase 3: User Story 1 - Summaries reflect the net spend already computed (Priority: P1) 🎯 MVP

**Goal**: Summaries read each item's stored net value, so manually-entered discounted itemized expenses stop overcounting.

**Independent Test**: Record an itemized expense whose items' face total exceeds the paid amount (a discount); the period summary's categories sum to the paid amount and category totals sum to the grand total.

- [ ] T004 [P] [US1] In `backend/tests/services/summary.test.ts`: add cases where items carry `effective_amount` below `amount` (discount) → `aggregateByCategory`/`aggregateBySubcategory` count the net value; equal/null `effective_amount` → output unchanged; assert Σ category totals ≤ grand total (SC-001 manual case, SC-002, SC-003, contract C1).
- [ ] T005 [US1] In `backend/src/db/queries.ts`, add `effective_amount` to the `transaction_items(...)` select in `getTransactionsForPeriod` (FR-001, FR-006). (Aggregators already use `effective_amount ?? amount` — no change there.)

**Checkpoint**: manual discounted transactions summarise at net; non-discounted unchanged.

---

## Phase 4: User Story 2 - Discounted invoices fill net spend (Priority: P2)

**Goal**: The two invoice-fill paths that skip the recompute now stamp each filled item's net value. Depends on US1 (summaries reading the value) and Foundational T003.

**Independent Test**: Import or resolve a discounted invoice onto an item-less transaction; the filled items' categories sum to the paid amount in the summary.

- [ ] T006 [P] [US2] In `backend/tests/handlers/pwa-import.test.ts`: after `POST /import/resolve` fills a discounted invoice, the matched tx's items carry `effective_amount` summing to `tx.amount` (C2); `POST /import/manual-link` regression still stamps it; `PUT /expense` edit keeps `effective_amount` reconciled to the edited amount (FR-008, C7).
- [ ] T007 [P] [US2] In `backend/tests/services/invoice-matcher.test.ts`: `runImportPipeline` auto-fill of a discounted invoice stamps `effective_amount` summing to the matched tx's paid amount; a non-discounted fill yields `effective_amount == amount`; the per-import subrequest/write-call shape is unchanged vs feature 024 (C3, C4).
- [ ] T008 [US2] In `backend/src/db/queries.ts`, add optional `effective_amount?: number | null` to the `bulkInsertTransactionItems` row shape (defaults to null → no change for other callers).
- [ ] T009 [US2] In `backend/src/services/invoice-matcher.ts` `runImportPipeline`, compute fill-item `effective_amount` in memory via `computeEffectiveShares` (keyed by array index) against each matched transaction's paid `amount`, and set it on the rows passed to `bulkInsertTransactionItems` (FR-001/004; no per-match subrequest added — preserves 024).
- [ ] T010 [US2] In `backend/src/handlers/pwa.ts` `POST /import/resolve`, after `applyInvoiceItems`, call `computeAndWriteEffectiveAmounts(supabase, tx.id, tx.amount)` so the resolved (confirmed-ambiguous) fill carries net values (FR-004).

**Checkpoint**: all forward fill paths (import auto, resolve, manual-link) produce net-correct summaries.

---

## Phase 5: User Story 3 - Existing discounted invoice records corrected (Priority: P3)

**Goal**: One-time backfill recomputes `effective_amount` for transactions already filled from discounted invoices, so past-period summaries reconcile.

**Independent Test**: A past invoice-filled discounted transaction that overcounts is corrected after running the backfill; that period reconciles.

- [ ] T011 [P] [US3] In `backend/tests/db/queries.test.ts` (or a new `backend/tests/scripts/backfill.test.ts`): test the pure selection/recompute logic — identifies invoice-sourced items (`source_invoice_id` set) whose face total ≠ `transactions.amount`, recomputes to net via the shared helper, is idempotent on re-run, and skips non-discounted and manual rows (C6).
- [ ] T012 [US3] Create `backend/scripts/backfill-effective-amounts.ts` with `--dry-run` (default, prints per-tx before→after) and `--apply` (writes). Selects invoice-filled discounted transactions and recomputes `effective_amount` via the per-tx writer; idempotent (FR-006). Mirror the env/Supabase bootstrap of existing scripts (e.g. `migrate-legacy.ts`).

**Checkpoint**: historical data corrected; SC-004 reconciles.

---

## Phase 6: Polish & Validation

- [ ] T013 Run the full backend gate `cd backend && pnpm run typecheck && pnpm run lint && pnpm run test` — all green, including the new US1/US2/US3 cases and the existing 275 (zero regressions, SC-003).
- [ ] T014 Execute `quickstart.md` §2 (manual e2e on dev) and §3 (`backfill --dry-run` then `--apply`, then idempotent re-run); tick the SC-001…SC-005 acceptance checklist.

---

## Dependencies & Execution Order

### Phase dependencies
- **Setup (P1)** → no deps.
- **Foundational (P2)** → after Setup; required by US2 and US3 (NOT by US1).
- **US1 (P3)** → after Setup; independent of Foundational — can run in parallel with P2.
- **US2 (P4)** → after Foundational (T003) and US1 (T005, the summary read).
- **US3 (P5)** → after Foundational (T003). Independently testable; benefits from US1's read to observe results.
- **Polish (P6)** → after the user stories you intend to ship.

### Within stories
- Tests are listed before/with implementation; write them to fail first, then implement.
- T003 (helper) before T009/T012 (consumers).
- T008 (bulk row shape) before T009 (sets the field).

### Parallel opportunities
- T002 ∥ (US1 tasks) — Foundational tests and US1 are independent.
- T004 (US1 test), T006 & T007 (US2 tests), T011 (US3 test) are all `[P]` (distinct files).
- T006 ∥ T007 (different test files).

---

## Parallel Example: User Story 2

```bash
# Tests first, in parallel (different files):
Task: "pwa-import.test.ts — resolve fill stamps effective_amount; manual-link regression; edit reconciliation"
Task: "invoice-matcher.test.ts — import fill stamps net effective_amount; subrequest shape unchanged"
# Then implementation (T008 → T009; T010 independent):
Task: "queries.ts — bulkInsertTransactionItems gains effective_amount"
Task: "invoice-matcher.ts — runImportPipeline computes in-memory shares"
Task: "pwa.ts — resolve recompute"
```

---

## Implementation Strategy

### MVP (US1 only)
1. Setup (T001) → US1 (T004–T005). 2. STOP & validate: manual discounted expenses now summarise at net. 3. Deployable on its own (no migration; backend redeploy).

### Incremental delivery
- US1 → fixes manual discounted transactions (MVP).
- + US2 → fixes the headline invoice-fill case (needs Foundational T002–T003).
- + US3 → corrects historical data (backfill script, run once at deploy).

### Notes
- No schema migration (`effective_amount` already exists, migrations 015–017).
- No API/PWA change — only stored values and summary numbers change.
- Deploy-time: redeploy backend; run `backfill-effective-amounts.ts --apply` once on prod.
