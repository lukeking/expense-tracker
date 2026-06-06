---
description: "Task list for Invoice Reconciliation Enhancements"
---

# Tasks: Invoice Reconciliation Enhancements

**Input**: Design documents from `/specs/023-invoice-reconcile-enhancements/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, contracts/schema-ddl.sql

**Tests**: INCLUDED — the project constitution (Quality Standards) mandates Vitest +
`@cloudflare/vitest-pool-workers` unit tests for CF Workers handlers, with explicit
coverage of the load-bearing edge cases (ambiguous match, enrichment-only count invariant).

**Organization**: Grouped by user story (US1 P1, US2 P2, US3 P3). The three stories are
independent — each can be implemented, tested, and shipped on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task → can run in parallel
- **[Story]**: US1 / US2 / US3 (omitted for Setup, Foundational, Polish)

## Path Conventions

Backend CF Worker at `backend/`, PWA at `pwa/`. Paths are repo-relative.

---

## Phase 1: Setup

- [X] T001 Create migration `backend/supabase/migrations/022_invoice_reviewed_at.sql` from `specs/023-invoice-reconcile-enhancements/contracts/schema-ddl.sql` (adds `invoices.reviewed_at timestamptz NULL`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the one operational schema gate. (Blocks US1 only; US2 and US3 have no schema dependency and can proceed in parallel with this.)

- [ ] T002 Apply migration 022 to the Supabase dev database (operational prerequisite for US1 reads/writes). **PENDING (user step):** run the `ALTER TABLE invoices ADD COLUMN reviewed_at TIMESTAMPTZ;` from `backend/supabase/migrations/022_invoice_reviewed_at.sql` in the Supabase SQL editor (same manual process used for migrations 020/021).

---

## Phase 3: User Story 1 — Mark-as-read review queue (Priority: P1) 🎯 MVP

**Goal**: The 已配對發票 list shows only unacknowledged matches by default; per-card 已讀 and bulk 全部標為已讀 hide them; a 顯示已讀 toggle reveals acknowledged matches (still un-linkable). The matched-list query is batched (no N+1).

**Independent Test**: With several linked invoices present, mark some/all read and confirm they leave the list and don't return; toggle 顯示已讀 to reveal + un-link one; confirm awaiting-resolution invoices are untouched and screen load is fast.

### Tests for User Story 1 ⚠️ (write first, ensure they fail)

- [X] T003 [P] [US1] Add cases to `backend/tests/handlers/pwa-import.test.ts`: `mark-read` accepts single id and bulk id list, sets read state, only affects `matched` invoices, `400` when neither field provided; `GET /import/matched` returns unread by default and all when `include_read=true`.
- [X] T004 [P] [US1] Add cases to `backend/tests/db/queries.test.ts`: `findAllMatchedInvoices` filters `reviewed_at IS NULL` by default + returns read rows when `includeRead`; `markInvoicesRead` sets `reviewed_at`; matched transaction fetch issues one batched query (logic-level assertion).

### Implementation for User Story 1

- [X] T005 [US1] Add `reviewed_at: string | null` to `Invoice` in `backend/src/types.ts`; add the mark-read request/response types.
- [X] T006 [US1] In `backend/src/db/queries.ts`: filter `findAllMatchedInvoices` by `reviewed_at IS NULL` with an `includeRead` option; add `markInvoicesRead(supabase, ids[])` setting `reviewed_at = now()`; replace the per-invoice transaction fetch in the matched path with one `.in('id', [...])` batched query.
- [X] T007 [US1] In `backend/src/handlers/pwa.ts`: have `GET /pwa/import/matched` honor `include_read`; add `POST /pwa/import/mark-read` accepting `{ invoice_id }` and/or `{ invoice_ids[] }` (matched-only; `400` on empty). (depends on T006)
- [X] T008 [US1] In `pwa/src/screens/ImportScreen.tsx`: add a per-card **已讀** action and a **全部標為已讀** bulk action on 已配對發票 (remove acknowledged from local state on success); add a **顯示已讀** toggle that refetches with `include_read=true`; default view shows only unread. (depends on T007)

**Checkpoint**: The review queue is bounded and fast; acknowledged matches reachable + un-linkable via the toggle. MVP deployable.

---

## Phase 4: User Story 2 — Discount-aware matching (Priority: P2)

**Goal**: A discounted expense recorded with its discount (paid + discount = invoice amount) auto-links to the full-price invoice; non-discounted transactions are unaffected; multiple matches stay ambiguous.

**Independent Test**: Record an expense paid 35 with a 5 discount; import a 40 invoice same-day → it auto-links (`near`). Confirm a no-discount expense behaves unchanged and a two-candidate case stays ambiguous.

### Tests for User Story 2 ⚠️ (write first, ensure they fail)

- [X] T009 [P] [US2] Add cases to `backend/tests/services/invoice-matcher.test.ts`: a tx with `amount + Σ discount = net` auto-links as `near`; a tx with no discount matches exactly as before (regression); ≥2 candidates (by paid OR gross) → `ambiguous`; transaction count identical before/after (SC-003).

### Implementation for User Story 2

- [X] T010 [US2] In `backend/src/db/queries.ts`: provide the auto-match candidate set within the ±2-day window where `amount == net_amount` OR `amount + Σ(discount-kind adjustment values) == net_amount` (fetch/aggregate discount adjustments for window candidates); dedup by transaction id. Leave the paid-amount-only behavior intact for transactions without discounts.
- [X] T011 [US2] In `backend/src/services/invoice-matcher.ts` (`runImportPipeline`): use the gross-aware candidate set for the auto-match step — exactly one ⇒ auto-link (confidence via existing `computeConfidence` → `near` when paid ≠ net), else `ambiguous`. No change to dedup/forex/skip branches. (depends on T010)

**Checkpoint**: Discounted expenses auto-link; existing matching unchanged for everything else.

---

## Phase 5: User Story 3 — Per-item replace in manual link (Priority: P3)

**Goal**: When manually linking, a selected invoice line can replace a chosen existing item's **name only** (amount / effective amount / tags preserved), as an alternative to appending; only the selected line is applied.

**Independent Test**: Manually link an invoice to a transaction with a placeholder item; replace that placeholder with one invoice line; confirm the name changes, amount/effective/tags are preserved, no duplicate, no other lines added; un-link later and confirm the renamed item survives.

### Tests for User Story 3 ⚠️ (write first, ensure they fail)

- [X] T012 [P] [US3] Add cases to `backend/tests/handlers/pwa-import.test.ts`: manual-link `replace` renames the targeted item (name changed; amount, effective_amount, tags, `source_invoice_id` unchanged); `replace` is independent of `item_indexes`; a `replace.item_id` not on the chosen transaction → `400`.

### Implementation for User Story 3

- [X] T013 [US3] In `backend/src/db/queries.ts`: add `renameTransactionItem(supabase, itemId, name)` updating only the `name` column.
- [X] T014 [US3] In `backend/src/handlers/pwa.ts`: extend `POST /pwa/import/manual-link` to accept `replace: { item_id, invoice_item_index }[]`; validate each `item_id` belongs to the chosen transaction; apply name-only renames; keep append (`item_indexes`) independent. (depends on T013)
- [X] T015 [US3] In `pwa/src/components/ManualLinkSheet.tsx`: add a per-item replace control — let the user point an invoice line at an existing item to rename it (distinct from the append checkboxes); include `replace` in the manual-link request. (depends on T014 contract)

**Checkpoint**: Placeholder items can be renamed from the invoice during manual link; append path unchanged.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T016 [P] Run the full backend suite (`cd backend && pnpm test`) and `tsc --noEmit` for backend and PWA; fix any regressions across invoice-matcher / queries / pwa-import. (272 backend tests pass; backend + PWA `tsc` clean; PWA `vite build` clean. Note: `pnpm lint` is broken project-wide by a pre-existing typed-linting config gap, unrelated to this feature.)
- [ ] T017 Run `specs/023-invoice-reconcile-enhancements/quickstart.md` end-to-end (US1 review queue + SC-002 load; US2 discount auto-link + ambiguity guard; US3 replace + un-link survival; SC-003 count unchanged throughout). **PENDING (user step):** needs the running app + live dev DB (after T002); manual verification per quickstart.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (T001)**: no deps.
- **Foundational (T002)**: needs T001; blocks US1 only.
- **US1 (T003–T008)**: after T002. Tests T003/T004 [P] → T005 → T006 → T007 → T008.
- **US2 (T009–T011)**: independent of US1; needs no migration. T009 [P] → T010 → T011.
- **US3 (T012–T015)**: independent of US1/US2. T012 [P] → T013 → T014 → T015.
- **Polish (T016–T017)**: after the targeted stories.

### Cross-file sequencing

- `backend/src/db/queries.ts` is edited by T006 (US1), T010 (US2), T013 (US3) → sequential when done together (same file), but each story's edit is isolated.
- `backend/src/handlers/pwa.ts` is edited by T007 (US1) and T014 (US3) → sequential.
- `backend/src/types.ts` (T005) is US1-only; US3's replace type is local to its handler/UI.
- `pwa/src/screens/ImportScreen.tsx` (T008) and `pwa/src/components/ManualLinkSheet.tsx` (T015) are different files → parallel across stories.

### Parallel opportunities

- The three stories can be developed in parallel by file area (US1 ImportScreen + matched query; US2 matcher; US3 ManualLinkSheet + manual-link handler), coordinating only on the shared `queries.ts` / `pwa.ts` edits.
- Within each story, the test task is [P] with the others' tests.

---

## Implementation Strategy

### MVP First (User Story 1)

1. Setup + Foundational (T001–T002).
2. US1 (T003–T008) → **STOP and VALIDATE**: review queue bounded, fast, acknowledged matches still un-linkable. Deployable MVP (the most pressing pain).

### Incremental Delivery

- + US2 (T009–T011): discounted expenses auto-link.
- + US3 (T012–T015): in-flow placeholder rename.
- Polish (T016–T017): green suite + quickstart validation.

---

## Notes

- [P] = different files, no incomplete dependency.
- Tests are constitution-mandated; write them before the implementation in each story.
- SC-003 (no transaction created/deleted) remains the load-bearing invariant — assert it in T009.
- Migration 022 (T002) is an operational step against the live dev DB, not a code edit.
