---
description: "Task list for Summary Subcategory Filter"
---

# Tasks: Summary Subcategory Filter

**Input**: Design documents from `specs/030-summary-subcategory-filter/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contract.md, quickstart.md

**Tests**: Test tasks are included because the plan's testing strategy (research D5) explicitly calls for a backend worker-test assertion + a Playwright E2E smoke. There is no PWA unit-test harness; correctness otherwise leans on `tsc` + `pnpm i18n:check`.

**Organization**: Tasks are grouped by the three user stories from spec.md (US1 P1, US2 P2, US3 P3). US2 and US3 build on the `subDrilldown` state introduced in US1 but are independently testable increments.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (setup, foundational, and polish tasks carry no story label)

## Path Conventions

Web app: PWA front-end in `pwa/`, CF Worker backend in `backend/`, Playwright E2E in `e2e/`. Paths below are repo-root-relative.

---

## Phase 1: Setup (Shared data plumbing)

**Purpose**: Expose the net per-item amount the feature reads. No new dependencies (in-house only).

- [ ] T001 Add `effective_amount` to the `transaction_items(...)` select projection (and the local `TxRow` interface) in `GET /pwa/transactions` — backend/src/handlers/pwa.ts
- [ ] T002 [P] Add `effective_amount: number | null` to the `TxItem` interface — pwa/src/hooks/useSummary.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure functions every user story relies on, plus the backend regression guard. MUST complete before user-story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T003 [P] Create pure helpers in pwa/src/lib/subcategory.ts: `itemInSubcategory(item, major, sub)`, `txInSubcategory(tx, major, sub)` (membership — `其他` = bare-major tag; else `Major:Sub` / `Major:Sub:` prefix), and `subAmount(tx, major, sub)` (refund-aware net sum of matching items' `effective_amount ?? amount`) per data-model.md
- [ ] T004 [P] Extend the worker test to assert `GET /pwa/transactions` returns `effective_amount` on each item — backend/tests/handlers/pwa-transactions-category.test.ts

**Checkpoint**: Net-amount data is available end-to-end and the helpers exist — user stories can begin.

---

## Phase 3: User Story 1 - Filter transactions by tapping a subcategory bar (Priority: P1) 🎯 MVP

**Goal**: Tapping a subcategory bar narrows the transaction list to that subcategory, **day-grouped** (Goal 1 — which days), and shows the subcategory's **net total** (Goal 2 — how much).

**Independent Test**: Drill into a major with ≥2 subcategories, tap one bar → the list shows only that subcategory's transactions grouped by day; the header shows the net subcategory total; each day's subtotal and the header total are net and reconcile.

- [ ] T005 [US1] Add `subDrilldown: string | null` state to `SummaryScreen` and reset it to `null` in `handleTimeBaseChange`, `handleNavigate`, `handlePickerSelect`, the drilldown back button, and on drilling into a different major (FR-007) — pwa/src/screens/SummaryScreen.tsx
- [ ] T006 [US1] Add `onClick` to the subcategory `<Bar>` to set `subDrilldown` to the tapped subcategory (select); switching to another bar replaces the selection (FR-001, FR-003) — pwa/src/screens/SummaryScreen.tsx
- [ ] T007 [US1] When `subDrilldown` is set, filter `txData.transactions` with `txInSubcategory(...)` before `groupTransactions(...)` so the history list day-groups to the subcategory (including the `其他` bucket) (FR-002) — pwa/src/screens/SummaryScreen.tsx
- [ ] T008 [US1] Thread the active `drilldown`/`subDrilldown` into the drilldown header and the day groups so the header headline total, each day subtotal, and any per-transaction figure are computed via `subAmount(...)` (net) when a subcategory is active (FR-005, FR-009) — pwa/src/screens/SummaryScreen.tsx
- [ ] T009 [P] [US1] E2E smoke: drill into a major, tap a subcategory bar → assert the list narrows + is day-grouped, the header shows the net subcategory total, and tapping a different bar swaps the selection — e2e/tests/view-summary.spec.ts

**Checkpoint**: US1 is fully functional — the filter answers both goals. MVP demoable.

---

## Phase 4: User Story 2 - Clear the subcategory filter (Priority: P2)

**Goal**: Clear the active subcategory filter in place — both by re-tapping the active bar and via a dedicated clear control — restoring the full major-category list.

**Independent Test**: With a subcategory filter active, re-tap the active bar → full major list returns; re-select, then tap the clear control → full major list returns; neither clears any active tag/payment filter.

- [ ] T010 [US2] Make the `<Bar>` onClick a toggle — tapping the already-selected subcategory clears `subDrilldown` (FR-006a) — pwa/src/screens/SummaryScreen.tsx
- [ ] T011 [US2] Add i18n key (e.g. `summary.showAll`) to both catalogs, matching wording (zh: 全部 / en: All) — pwa/src/i18n/zh.ts and pwa/src/i18n/en.ts
- [ ] T012 [US2] Render a dedicated clear control in the drilldown header, visible only while `subDrilldown` is set, that clears the selection (FR-006b), using the T011 label — pwa/src/screens/SummaryScreen.tsx
- [ ] T013 [US2] Extend the E2E smoke: assert both clear paths (re-tap active bar, and the clear control) restore the full major-category list — e2e/tests/view-summary.spec.ts

**Checkpoint**: US1 + US2 work — filter can be set and cleared two ways.

---

## Phase 5: User Story 3 - See which subcategory is active (Priority: P3)

**Goal**: The active subcategory is obvious — non-selected bars take the 百葉窗 shade and the header becomes a breadcrumb (Major › Subcategory) with the net total.

**Independent Test**: With a subcategory filter active, the non-selected bars are visibly shaded (selected bar shows through) and the header reads `Major › Sub` with the net total; clearing reverts the shade and the header.

- [ ] T014 [US3] Apply the 百葉窗 shade to the non-selected bars when a subcategory is selected — a lightweight semi-transparent overlay (per-`<Cell>` `fillOpacity` transition or an overlay layer) that animates down on select and retracts on clear, leaving the selected bar showing through (FR-008) — pwa/src/screens/SummaryScreen.tsx
- [ ] T015 [US3] Restructure the drilldown header into a breadcrumb (Major › Subcategory) with the net subcategory total when selected, reverting to the major + major total on clear (FR-009) — pwa/src/screens/SummaryScreen.tsx
- [ ] T016 [US3] Extend the E2E smoke: assert the breadcrumb (Major › Sub) + net total appear and the non-selected bars are shaded while filtered, and both revert on clear — e2e/tests/view-summary.spec.ts

**Checkpoint**: All three stories functional and independently verifiable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T017 [P] Run `cd backend && pnpm test`, `cd pwa && pnpm exec tsc -b`, and `cd pwa && pnpm i18n:check`; fix any failures (type/key-parity/worker test)
- [ ] T018 Run the quickstart.md manual verification on the dev build (Vite :5300), including the discounted-item net check and the `其他` bucket
- [ ] T019 [P] Confirm no regression to the unfiltered major-level drilldown and the all-time/period views, and that the result matches the quickstart.md mockup

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 and T002 have no dependencies (T002 [P] alongside T001).
- **Foundational (Phase 2)**: T003 [P] independent; T004 [P] logically needs T001 (asserts the new projection). Blocks all user stories.
- **User Stories (Phase 3–5)**: All depend on Foundational. US1 must land first (it introduces `subDrilldown` + the `<Bar>` onClick). US2 and US3 build on that state but are independent increments of each other.
- **Polish (Phase 6)**: After the desired stories are complete.

### User Story Dependencies

- **US1 (P1)**: After Foundational. Establishes the state machine + filter + net amounts.
- **US2 (P2)**: After US1 (extends the `<Bar>` onClick to toggle + adds the clear control).
- **US3 (P3)**: After US1 (adds the shade + breadcrumb on top of the existing state). Independent of US2.

### Within `SummaryScreen.tsx`

T005 → T006 → T007 → T008 are sequential edits to the same file (no [P]). The same applies to T010/T012 and T014/T015. The E2E spec (T009 → T013 → T016) is edited sequentially across phases.

### Parallel Opportunities

- T002 [P] runs alongside T001.
- T003 [P] and T004 [P] run in parallel within Phase 2.
- T009 [P] (E2E) can be authored alongside the US1 component edits.
- T017 [P] and T019 [P] in Polish.

---

## Parallel Example: Phase 1–2 kickoff

```bash
# Setup (parallel):
Task: "T001 backend: add effective_amount to /pwa/transactions select (backend/src/handlers/pwa.ts)"
Task: "T002 [P] pwa: add effective_amount to TxItem (pwa/src/hooks/useSummary.ts)"

# Foundational (parallel, after T001 for T004):
Task: "T003 [P] pwa: pure helpers in pwa/src/lib/subcategory.ts"
Task: "T004 [P] backend: assert effective_amount in pwa-transactions-category.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → Phase 2 Foundational.
2. Phase 3 (US1): filter + day-grouping + net amounts.
3. **STOP and VALIDATE**: drill in, tap a bar, confirm day-grouped list + net total reconcile. This already delivers both user goals.

### Incremental Delivery

1. Setup + Foundational → data + helpers ready.
2. US1 → filter answers "which days" + "how much" (MVP).
3. US2 → in-place clear (two ways).
4. US3 → 百葉窗 shade + breadcrumb header.
5. Polish → typecheck/i18n/worker test + manual + mockup parity.

---

## Notes

- [P] = different files, no incomplete dependency. Most US tasks share `SummaryScreen.tsx`, so they are sequential.
- The PWA computes amounts client-side (no extra fetch); the only backend change is T001 (one projected column).
- Known edge (research D3): transactions tagged only at the transaction level may diverge slightly from the bar; not reproduced client-side by design.
- Commit after each task or logical group; the `after_tasks` hook will commit this file.
