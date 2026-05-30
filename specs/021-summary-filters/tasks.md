# Tasks: Advanced Summary Filters

**Input**: Design documents from `specs/021-summary-filters/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-diff.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- Exact file paths in all descriptions

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Backend filter params and frontend hook refactor — both must land before any UI component can render correctly.

⚠️ **CRITICAL**: No component work can begin until T001–T005 are complete.

- [ ] T001 Extend `GET /pwa/summary` with optional `tag` and `payment_method` query params — in-Worker tag filter + Supabase `.eq()` for payment_method in `backend/src/handlers/pwa.ts`
- [ ] T002 [P] Extend `GET /pwa/transactions` with optional `tag` and `payment_method` query params in `backend/src/handlers/pwa.ts`
- [ ] T003 [P] Extend `GET /pwa/summary/subcategories` with optional `tag` and `payment_method` query params in `backend/src/handlers/pwa.ts`
- [ ] T004 Write Vitest unit tests for tag + payment_method filter logic in `backend/tests/handlers/pwa-filters.test.ts`
- [ ] T005 Replace `WindowOption` with `TimeBase + offset` model in `pwa/src/hooks/useSummary.ts`: add `TimeBase` type, `timeBaseToRange()`, update `useSummaryData` / `useSubcategoryData` / `useTransactions` signatures to accept `tag?` and `paymentMethod?`

**Checkpoint**: Backend filters working + frontend hook updated — component work can begin

---

## Phase 2: User Story 3 + 4 — Time Window Navigation (Priority: P1/P2) 🎯 MVP

**Goal**: Replace preset pills with week/month/year/全部 tabs + ◀ label ▶ arrows + tap-to-pick period picker.

**Independent Test**: Open summary tab — see `週|月|年|全部` tabs, current week label, working ◀/▶ arrows. Tap label → period picker opens. Select April 2019 → summary loads that period.

- [ ] T006 [US3] Build `SummaryNav` component: time-base tabs + ◀/▶ arrows + tappable label in `pwa/src/components/SummaryNav.tsx`
- [ ] T007 [US3] Build `PeriodPicker` component: 2-step modal (year list → month grid / week list) in `pwa/src/components/PeriodPicker.tsx`
- [ ] T008 [US3] Update `SummaryScreen`: replace `TimeWindowPicker` with `SummaryNav`; add `timeBase`/`offset` state; wire `PeriodPicker` open/close; update `groupTransactions()` for new time bases; remove `WindowOption` import in `pwa/src/screens/SummaryScreen.tsx`
- [ ] T009 [US3] Delete `pwa/src/components/TimeWindowPicker.tsx`

**Checkpoint**: Time navigation fully functional. Old preset pills gone. Period picker works.

---

## Phase 3: User Story 1 + 2 — Tag + Payment Method Filters (Priority: P1)

**Goal**: Filter bar appears below nav showing tag chips and payment method pills derived from current window's transactions.

**Independent Test**: In month view, tap a tag chip → totals and list update to matching transactions only. Tap a payment method pill → same. Tap both → AND logic. 全部 mode hides filter bar.

- [ ] T010 [P] [US1] Build `FilterBar` component: scrollable tag chips + payment method pills with active/inactive state in `pwa/src/components/FilterBar.tsx`
- [ ] T011 [US1] Wire `FilterBar` into `SummaryScreen`: add `tag`/`paymentMethod` state; derive `availableTags` + `availablePMs` from unfiltered `useTransactions` call; pass filter state to all query hooks; hide bar in `all` mode in `pwa/src/screens/SummaryScreen.tsx`

**Checkpoint**: Full feature complete — time nav + tag filter + payment filter all working together.

---

## Phase 4: Polish & Deploy

- [ ] T012 Manual smoke test per `specs/021-summary-filters/quickstart.md` steps 1–7 on local dev (`wrangler dev` + `vite dev`)
- [ ] T013 Deploy backend: `pnpm run deploy` from `backend/`

---

## Dependencies & Execution Order

- **Phase 1 (T001–T005)**: No dependencies — start immediately. T001/T002/T003 are parallel (different endpoints). T004 can run alongside T001–T003. T005 is independent of backend tasks.
- **Phase 2 (T006–T009)**: Requires T005 complete (new hook signatures). T006 and T007 are parallel (different files).
- **Phase 3 (T010–T011)**: Requires T005 + T008 complete. T010 can run alongside T008.
- **Phase 4 (T012–T013)**: Requires all prior tasks complete.

### Parallel Opportunities

```
T001 ── T002 ── T003   (all Phase 1 backend tasks — parallel)
T004                   (parallel with T001–T003)
T005                   (parallel with T001–T004)

After T005:
T006 ── T007           (Phase 2 — parallel)
T010                   (Phase 3 — parallel with T008 since different files)
```

---

## Implementation Strategy

### MVP (Phase 1 + Phase 2)

1. Complete T001–T005 (foundation)
2. Complete T006–T009 (time navigation)
3. Validate: time nav works end-to-end
4. Then add filter bar (Phase 3)

### Full Feature

Add Phase 3 on top of MVP. Phase 4 closes with smoke test + deploy.
