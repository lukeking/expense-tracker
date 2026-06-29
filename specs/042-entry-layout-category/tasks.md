---
description: "Task list for 042-entry-layout-category"
---

# Tasks: Entry Fee/Refund Layout Alignment + Major-Category Selector

**Input**: Design documents from `specs/042-entry-layout-category/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not requested as TDD. e2e smoke is included as an OPTIONAL polish task (quickstart references it). All other verification is via `tsc -b`, `i18n:check`, and manual quickstart.

**Organization**: Tasks grouped by user story. This is a frontend-only PWA change (no backend/DB).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (maps to spec.md user stories)

## Path Conventions

All paths under `pwa/src/` (PWA React app). No backend/Android paths in this feature.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before changes.

- [x] T001 Confirm on branch `042-entry-layout-category` and baseline green: `cd pwa && pnpm exec tsc -b && pnpm i18n:check`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None. US1 and US2 are independent and need no shared prerequisite; US3 builds on US1's restructured forms. No foundational tasks.

**Checkpoint**: Proceed directly to user stories (US1 and US2 may run in parallel).

---

## Phase 3: User Story 1 - Consistent fee/refund flow led by the linked original (Priority: P1) 🎯 MVP

**Goal**: Both tabs share the order 金額 → 連結原始交易 → 付款管道 → [分類, fee] → 說明, with 連結原始交易 promoted to a rich card directly under 金額. Auto-fill behavior (spec 041) preserved.

**Independent Test**: Open 手續費 and 退款; confirm field order and the link rendered as a card under 金額; link an original and confirm downstream fields fill and stay editable; clear/re-link behaves non-destructively.

### Implementation for User Story 1

- [x] T002 [P] [US1] Update i18n in `pwa/src/i18n/zh.ts` + `pwa/src/i18n/en.ts`: change `entry.linkOriginal` (drop 「（可選）」), add link-card meta + refund 全額退/部分退 + 原金額 strings (per contracts/fee-refund-layout.md)
- [x] T003 [US1] Rework `ParentSearch.tsx` linked state into the rich card — 🔗 + title (`note ?? item_names[0] ?? tags[0]`) + meta line `付款 · 分類 · NT$金額 · M/D` (omit 分類 when `category` null) + ✕ clear — per data-model `LinkedOriginalCard`. First **export `LABEL_KEYS` from `PaymentPills.tsx`** (currently module-private) so the card can render the payment-method label via `t(LABEL_KEYS[pm])`; no API change
- [x] T004 [US1] Reorder `FeeForm` in `EntryScreen.tsx` to 金額 → 連結原始交易 → 付款方式 → 分類 → 說明 (move `ParentSearch` directly under amount, 說明 last); preserve `paymentTouched`/`categoryTouched` auto-fill gating unchanged
- [x] T005 [US1] Reorder `RefundForm` in `EntryScreen.tsx` to 金額 → 連結原始交易 → 退款至 → 說明; render 全額退/部分退 + 原金額 hint within the link-card area and keep the existing 全額退款 (`amount = parent.amount`) behavior + `paymentTouched` gating

**Checkpoint**: US1 fully functional — both tabs match the synced design's structure (`pwa/design-preview/refined/entry-fee|entry-refund/optimized.html`), behavior preserved. MVP shippable.

---

## Phase 4: User Story 2 - Find the right major category fast on mobile (Priority: P1)

**Goal**: Major row = frequency-ranked top-N + 「⋯ 更多」 sheet (no horizontal scroll); sub-categories also frequency-ordered. Independent of US1.

**Independent Test**: On 390px, confirm the major row fits with zero horizontal scroll, most-used first, 「更多」 opens the full list; sub-chips most-used first; empty history falls back to default order.

### Implementation for User Story 2

- [x] T006 [P] [US2] Add i18n keys to `pwa/src/i18n/zh.ts` + `pwa/src/i18n/en.ts`: `category.allMajorsTitle` and the 「更多」 label (per contracts/category-picker.md)
- [x] T007 [P] [US2] Create `pwa/src/hooks/useCategoryUsage.ts`: one bounded recent-transactions fetch (~180d) via existing `/pwa/transactions` (long `staleTime`), `useMemo` count of distinct `主:子` colon-tags from `tags` + `items[].tags` (major recognised against `useCategories`), returns `{ majorRank, subRank, hasData }` with `sort_order` tie-break (per data-model.md + research D1)
- [x] T008 [US2] Rework `CategoryPicker.tsx` major row: frequency top-N inline chips (single `N` constant, fit one row) + 「⋯ 更多」 opening the existing `BottomSheet` listing all majors with icons; selected major always visible; remove `overflow-x-auto`; consume `useCategoryUsage` with fallback to `useMajors` order
- [x] T009 [US2] In `CategoryPicker.tsx`, order visible sub-chips and the sub-overflow sheet list by `useCategoryUsage` `subRank` (fallback to `useSubcategories` order when `hasData` is false)

**Checkpoint**: US2 fully functional and independently testable; applies everywhere `CategoryPicker` is used (props unchanged).

---

## Phase 5: User Story 3 - Direction-aware money cues and readiness feedback (Priority: P2)

**Goal**: Fee amount framed as added cost, refund amount framed as money returning; inline readiness hint above submit on both tabs. Builds on US1's restructured forms.

**Independent Test**: Compare amount treatment on 手續費 (附加成本) vs 退款 (green +退回); fill required fields and confirm the inline ✓ hint appears above 送出.

### Implementation for User Story 3

- [x] T010 [P] [US3] Add i18n keys to `pwa/src/i18n/zh.ts` + `pwa/src/i18n/en.ts`: fee「附加成本」, refund「退回」, and the readiness hint (e.g. `entry.readyToSubmit`)
- [x] T011 [US3] In `FeeForm` (`EntryScreen.tsx`): frame 金額 as 「附加成本」 and add the inline ✓「必填已完成…可送出」 hint above the submit button (shown when `canSubmit`)
- [x] T012 [US3] In `RefundForm` (`EntryScreen.tsx`): apply the green 「+ NT$ … 退回」 amount framing and add the inline ✓ readiness hint above submit

**Checkpoint**: All three stories functional; fee/refund tabs visually match the synced design references end-to-end.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T013 [P] Run `cd pwa && pnpm exec tsc -b && pnpm i18n:check` and resolve any type/parity issues
- [x] T014 Visual verification at 390px against `pwa/design-preview/refined/entry-fee/optimized.html` + `entry-refund/optimized.html`: field order, link card, direction cues, readiness hint; confirm major row has zero horizontal scroll and 「更多」 sheet works
- [ ] T015 [P] (Optional) Add/extend Playwright e2e smoke in `e2e/` for fee/refund field order + major-row no-overflow + 「更多」 opens sheet (needs local Supabase; not in CI — run locally)
- [x] T016 Run `specs/042-entry-layout-category/quickstart.md` end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none — start immediately.
- **Foundational (Phase 2)**: empty — no blockers.
- **US1 (Phase 3)** and **US2 (Phase 4)**: independent — can run in parallel after Setup.
- **US3 (Phase 5)**: depends on **US1** (modifies the same restructured FeeForm/RefundForm).
- **Polish (Phase 6)**: after the desired stories are complete.

### Within Each Story

- **US1**: T002 (i18n) → T003 (ParentSearch card) → T004 (FeeForm) → T005 (RefundForm). T004 and T005 edit the same file (`EntryScreen.tsx`) — sequential, not parallel.
- **US2**: T006 (i18n) and T007 (hook) can run in parallel → T008 (CategoryPicker major) → T009 (CategoryPicker subs). T008/T009 same file — sequential.
- **US3**: T010 (i18n) → T011 (FeeForm) → T012 (RefundForm). T011/T012 same file — sequential.

### Parallel Opportunities

- US1 and US2 are independent (US1: `EntryScreen.tsx` + `ParentSearch.tsx`; US2: `CategoryPicker.tsx` + new `useCategoryUsage.ts`) — can be built in parallel.
- ⚠️ The three i18n tasks (T002, T006, T010) all edit `zh.ts`/`en.ts`; each is `[P]` *within its own story* (different file from that story's components), but do **not** run T002/T006/T010 simultaneously against each other — they share files.

---

## Implementation Strategy

### MVP First

1. Phase 1 (Setup) → Phase 3 (US1). **STOP and validate**: fee/refund layout matches design, behavior intact. This is the originally-designed core and is shippable alone.

### Incremental Delivery

1. US1 → validate/demo (MVP: unified layout + link card).
2. US2 → validate/demo (category selector — independent, also P1).
3. US3 → validate/demo (direction cues + readiness hint — polish on US1).
4. Polish (T013–T016).

### Notes

- `[P]` = different files, no dependency on an incomplete task.
- Commit after each task or logical group (the project auto-commits on speckit phases; implementation commits are manual).
- Behavior baseline (auto-fill, full-refund, single-category resolution) is inherited from spec 041 — do not re-implement; only relocate/repackage.
- No DB/backend/Android changes in any task.
