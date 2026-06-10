---
description: "Task list for 026-item-category-tagging"
---

# Tasks: Usable item-level category assignment

**Input**: Design documents from `/specs/026-item-category-tagging/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/internal-api.md

**Tests**: Backend handler/query tests are **required** here — Constitution Quality Standards mandate Vitest coverage for every CF Workers request handler. The PWA has no test runner, so UI is validated manually via quickstart.md.

**Organization**: Grouped by user story. US1 is the MVP and also delivers the shared `ItemCategorySheet` that US2 reuses.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: US1 / US2 (Setup, Foundational, Polish carry no story label)

## Path Conventions

Web app: `backend/src/`, `backend/tests/`, `pwa/src/` (per plan.md Structure Decision).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm a green baseline before changes.

- [x] T001 Baseline check: run `cd backend && pnpm test` and `cd pwa && pnpm build` and confirm both pass on `026-item-category-tagging` before edits.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: None. There is no story-agnostic blocking work — the one shared piece (`ItemCategorySheet`) is delivered by US1 and reused by US2. The US2 **backend** (Phase 4) has no dependency on US1 and may proceed in parallel.

**Checkpoint**: Proceed directly to US1 (and US2 backend in parallel).

---

## Phase 3: User Story 1 - Searchable / major-filterable item picker (Priority: P1) 🎯 MVP

**Goal**: Replace `ItemRow`'s flat, ungrouped tag list with a searchable, major-filterable bottom sheet, reused everywhere items are categorized.

**Independent Test**: In Entry and Edit, open an item's category control; typing type-ahead filters to matching `major:sub`; tapping a major narrows to its subcategories; 繼承/清除 still work.

- [x] T002 [US1] Create `pwa/src/components/ItemCategorySheet.tsx`: a `BottomSheet` with (1) a search input that type-ahead filters across `major` and `major:sub`, (2) horizontally-scrollable major filter chips, (3) subcategory chips for the selected major, (4) a 繼承主分類 / 清除 row. Props `{ value: string|null, inheritedTag: string|null, extraTags?: string[], open, onClose, onSelect(tag: string|null) }`. Reuse `useCategories`/`useMajors`/`useSubcategories` and the chips/search idiom from `pwa/src/components/CategoryPicker.tsx`. Include off-catalog `extraTags` containing `:` as selectable options (FR-005).
- [x] T003 [US1] Refactor `pwa/src/components/ItemRow.tsx` to render `<ItemCategorySheet>` in place of the inline flat sheet: remove the flat `dbOptions`/`allTagOptions` construction (lines ~62-68) and the flat `.map` list (lines ~160-169); pass `value={item.tagOverride}`, `inheritedTag`, `extraTags`, and wire `onSelect` to the existing `selectTag`. Keep the trigger button + display behavior.
- [x] T004 [US1] Manual verify per quickstart §2 US1 (Entry + Edit screens): search type-ahead, major filter, subcategory pick, 繼承/清除. Confirm no flat-list remnants remain.

**Checkpoint**: US1 is independently shippable — the item picker is usable in manual entry and editing.

---

## Phase 4: User Story 2 - Surface + inline-assign uncategorized items (Priority: P2)

**Goal**: Show each item's category + an `⚠ 未分類` flag and an inline tap-to-assign in the import review and the Summary transaction list, backed by a focused per-item PATCH. Lets invoice-filled and legacy-migration items move out of 其他.

**Independent Test**: Import an invoice auto-filling items onto a `全家`-only transaction → items show 未分類 in the review → assign inline → flag clears. Separately, from the Summary list assign a legacy 未分類 item → its spend leaves 其他 in the summary; grand total unchanged.

**Note**: Backend tasks (T005–T010) have no dependency on US1 and may run in parallel with Phase 3. Frontend surfaces (T013–T014) depend on US1's `ItemCategorySheet`.

### Backend — write path & read shape

- [x] T005 [P] [US2] `backend/src/db/queries.ts`: add `updateTransactionItemTags(supabase, itemId, tags: string[])` (modeled on `renameTransactionItem`, updates only `tags`); add `id` to the `getTransactionItemsByTransactionIds` select and its `Pick<TransactionItemRow, …>` return type.
- [x] T006 [US2] `backend/src/handlers/pwa.ts`: add `pwaRouter.patch('/transactions/:id/items/:itemId', …)` per contracts/internal-api.md — `400 INVALID_PAYLOAD`/`INVALID_CATEGORY_TAG`, `404 NOT_FOUND` (tx or item), `403 NOT_EXPENSE`; merge tags as `currentTags.filter(t => !t.includes(':'))` + (`category_tag` when non-null); persist via `updateTransactionItemTags`; record a `transaction_edit_history` row by reusing `readItemsForDiff` + `computeEditDiff` (header/adjustments unchanged, items-only diff); no `effective_amount` recompute. Depends on T005.
- [x] T007 [US2] `backend/src/handlers/pwa.ts`: include item `id` in the `/import/matched` item mapping (~line 927: `{ id: it.id, name, amount, tags }`). Depends on T005 (select now returns `id`).

### Backend — tests (constitution-required)

- [ ] T008 [P] [US2] `backend/tests/db/queries.test.ts`: `updateTransactionItemTags` writes only `tags`; `getTransactionItemsByTransactionIds` returns `id`.
- [x] T009 [P] [US2] Create `backend/tests/handlers/pwa-item-category.test.ts`: PATCH assigns a category to a `tags: []` item; reassign replaces the single `:`-tag; `null` clears it; a plain tag (`全家`) is preserved across assign/clear; `amount`/`effective_amount` unchanged; an edit-history row is written on change and **not** on an idempotent re-assign; `404` unknown tx/item; `403` non-expense tx.
- [x] T010 [P] [US2] `backend/tests/services/summary.test.ts`: regression — an item moved from `tags: []` to `tags: ['飲食:零食']` shifts its `effective_amount ?? amount` from 其他 to 飲食 in `aggregateByCategory`; the period grand total is unchanged (SC-005).

### Frontend — shared predicate, API, surfaces

- [x] T011 [P] [US2] Create `pwa/src/lib/itemCategory.ts`: export `isItemUncategorized(item: { tags: string[] }, tx: { tags: string[] }): boolean` = item has no `:`-tag AND tx has no `:`-tag (FR-007 / data-model predicate).
- [x] T012 [P] [US2] `pwa/src/api/client.ts`: add `assignItemCategory(txId: string, itemId: string, categoryTag: string | null)` issuing `PATCH /pwa/transactions/:id/items/:itemId` with `{ category_tag }`.
- [x] T013 [US2] `pwa/src/screens/ImportScreen.tsx`: add `id` to the `LinkedInvoice.transaction.items` type; in the 交易品項 list, show the item's `#major:sub` or an `⚠ 未分類` flag via `isItemUncategorized`; on tap open `<ItemCategorySheet>` and call `assignItemCategory`, then update local `linked` state so the flag clears. Depends on T002, T007, T011, T012.
- [x] T014 [US2] `pwa/src/screens/SummaryScreen.tsx`: in the transaction item line (~lines 95-98), show the item's category or `⚠ 未分類` flag; on tap open `<ItemCategorySheet>` and call `assignItemCategory`, then invalidate the `['summary', …]` and `['transactions', …]` react-query keys so the moved spend re-aggregates. Depends on T002, T011, T012.
- [x] T015 [US2] Manual verify per quickstart §2 US2(a) + US2(b): import-review inline assign clears the flag without re-import; Summary inline assign moves spend out of 其他 with the grand total unchanged.

**Checkpoint**: US2 complete — uncategorized invoice/legacy items are visible, flagged, and fixable inline from both surfaces.

---

## Phase 5: Polish & Cross-Cutting

- [x] T016 [P] Run `cd backend && pnpm test` (all green) and `cd pwa && pnpm build` + typecheck (no errors).
- [x] T017 [P] Final review: confirm the flat-list code is fully removed from `ItemRow.tsx`, the three surfaces share one `ItemCategorySheet`, and quickstart.md steps still match the implementation.

---

## Dependencies & Execution Order

- **Phase 1 (T001)** → before all.
- **Phase 2** — empty (no blocking foundational work).
- **US1 (T002 → T003 → T004)** — sequential within the story; T002 is the MVP-critical shared component.
- **US2 backend (T005 → {T006, T007}; tests T008-T010 [P])** — independent of US1; can run in parallel with Phase 3.
- **US2 frontend (T011 [P], T012 [P]) → {T013 (needs T002, T007, T011, T012), T014 (needs T002, T011, T012)} → T015`**.
- **Polish (T016, T017)** — after US1 + US2.

### Cross-story dependency

US2's UI surfaces (T013, T014) reuse US1's `ItemCategorySheet` (T002). US2's backend does not depend on US1.

## Parallel Opportunities

- After T001: start **US1 (T002)** and **US2 backend (T005)** concurrently.
- `[P]` batch once their files are free: T008, T009, T010 (distinct test files) and T011, T012 (distinct frontend files).

## Implementation Strategy

- **MVP = US1** (T001-T004): a usable item category picker in Entry/Edit — shippable on its own.
- **Increment = US2** (T005-T015): surfacing + inline assignment across import review and Summary, backed by the PATCH endpoint; reclaims the 其他 backlog.
- **Total tasks**: 17 (US1: 3 impl + 1 verify; US2: 3 backend impl + 3 tests + 2 frontend infra + 2 surfaces + 1 verify; Setup 1; Polish 2).

## Implementation Status (2026-06-09)

Implemented and statically verified: 301 backend tests pass, PWA `tsc -b && vite build` clean, backend lint 0 errors.

Open items:
- **T004, T015** — ✅ manually verified 2026-06-10 via quickstart.md §2 walkthroughs. Verification surfaced one bug, fixed same day: the PWA CORS allow-list lacked `PATCH`, so the browser blocked the item-assign request after preflight (`backend/src/handlers/pwa.ts`).
- **T008** — the no-DB-harness test convention (DB-call query fns aren't unit-tested in this repo) means the substantive new logic — the tag-merge rule — is covered by `tests/handlers/pwa-item-category.test.ts` (T009) instead of literal `queries.test.ts` assertions. The `id`-select change is exercised by the PWA typecheck against the `/import/matched` consumer.
