# Tasks: Item Row Redesign (018)

**Input**: Design documents from `/specs/018-item-note/`
**Prerequisites**: plan.md ✓, spec.md ✓, data-model.md ✓, contracts/schema-ddl.sql ✓, quickstart.md ✓

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no unresolved dependencies)
- **[Story]**: Which user story this task belongs to (US1–US5)

---

## Phase 2: Foundational — Migration

**Purpose**: Apply schema change. Blocks all user story work.

**⚠️ CRITICAL**: Must be complete before any frontend or backend changes are validated.

- [x] T001 Write `backend/supabase/migrations/018_item_note.sql` using DDL from `specs/018-item-note/contracts/schema-ddl.sql`
- [ ] T002 Apply migration in Supabase SQL Editor; verify via `SELECT column_name FROM information_schema.columns WHERE table_name = 'transaction_items' AND column_name = 'note'` → 1 row

**Checkpoint**: `note` column exists on `transaction_items` — frontend and backend can now use it.

---

## Phase 3: US1 + US2 — Item Layout & Max Button (Priority: P1) 🎯 MVP

**Goal**: Entry form opens with one pre-populated item row; Max fills the correct amount accounting for absolute adjustments; submission is blocked when no items exist.

**Independent Test (US1)**: Open entry form → one item row visible. Fill amount NT$500, tap Max → item amount = 500. Submit → toast "記錄成功"; DB shows one item with amount = 500.

**Independent Test (US2)**: Amount NT$450, discount NT$50, item 1 NT$300 → tap Max on item 2 → fills NT$200. Reconciliation green ✓.

- [x] T003 [P] [US1] Rewrite `pwa/src/components/ItemRow.tsx`: two-line layout (line 1: tag selector, name input, −, amount input, +, remove ×; line 2: note input + Max button); add `onMax: (() => void) | null` prop; show `≈Max` when `item.approxFlag`; clear `approxFlag: false` in all amount-edit handlers (handleAmountInput, increment, decrement)
- [x] T004 [P] [US1] Update `pwa/src/screens/EntryScreen.tsx`: change `items` initial state from `[]` to `[newItem()]`; extend `newItem()` to return `{ ..., note: '', approxFlag: false }`
- [x] T005 [US1] Add submit guard in `pwa/src/screens/EntryScreen.tsx`: derive `canSubmit = amountVal > 0 && items.length > 0`; show `<p className="text-xs text-orange-500">請至少新增一個品項</p>` when `items.length === 0`
- [x] T006 [US2] Implement `makeOnMax(itemId)` in `pwa/src/screens/EntryScreen.tsx` with full formula (Σabs_gross + Σpct_gross gross-up, sets `approxFlag`); pass `onMax={makeOnMax(item.id)}` to each `<ItemRow>`; update form reset on success to `setItems([newItem()])` and `setShowAdj(false)`

**Checkpoint**: US1 and US2 are fully functional. Single-item and multi-item absolute-discount entries work correctly.

---

## Phase 4: US3 + US4 — Adjustments Placement & % Gross-Up (Priority: P2)

**Goal**: Adjustments section accessible via expand arrow on the amount row, appearing between amount field and items list. % discount gross-up fills correct rounded estimate with ≈ when inexact.

**Independent Test (US4)**: Open entry form — no discount section visible. Tap ▾ on amount row → section appears above items list. Add a discount row, collapse, re-expand → row preserved.

**Independent Test (US3)**: Amount NT$180, 10% discount, tap Max → fills NT$200, no ≈. Amount NT$100, 10% discount, tap Max → fills NT$112, ≈ shows. Tap − → NT$111, ≈ clears.

- [x] T007 [US4] Add `showAdj` state (`useState(false)`) to `pwa/src/screens/EntryScreen.tsx`; add expand arrow button (`▸`/`▾`) to the right of the amount input field; wire to `setShowAdj(v => !v)`
- [x] T008 [US4] Replace the existing `<details>` adjustments block in `pwa/src/screens/EntryScreen.tsx` with `{showAdj && <div>…</div>}` rendered between the amount field row and the items list

*(US3 ≈ behavior is already implemented: T003 renders `≈Max` from `item.approxFlag`; T006's `makeOnMax()` sets `approxFlag` based on fractional gross-up.)*

**Checkpoint**: Adjustments section placement matches spec. % discount gross-up works. ≈ indicator appears/clears correctly.

---

## Phase 5: US5 — Per-Item Note (Priority: P3)

**Goal**: Note field on ItemRow line 2 round-trips to DB. Empty note stored as null.

**Independent Test**: Fill name "拿鐵", note "少冰", submit. Query DB → `name = "拿鐵"`, `note = "少冰"`.

- [x] T009 [P] [US5] Extend `insertTransactionItems` item type in `backend/src/db/queries.ts` to include `note?: string | null`; add `note: item.note ?? null` to the rows mapping
- [x] T010 [P] [US5] Update `backend/src/handlers/pwa.ts`: (1) add category tag filter `free_tags = rawTags.filter(t => !t.includes(':'))`; (2) pass `note: i.note?.trim() || null` per item in the `insertTransactionItems` call
- [x] T011 [US5] Update submit payload in `pwa/src/screens/EntryScreen.tsx`: change `items.map(...)` to include `note: i.note.trim() || null`

**Checkpoint**: Per-item note saves and retrieves correctly. Category tag filter prevents `category:value` tags from leaking onto the transaction row.

---

## Phase 6: Polish & Smoke Test

**Purpose**: End-to-end validation across all user stories.

- [x] T012 Run manual smoke test per `specs/018-item-note/quickstart.md` Steps 2–9; verify all acceptance scenarios pass (US1–US5 + submit guard + category tag guard)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: Start immediately — blocks all other phases
- **US1+US2 (Phase 3)**: Starts after T002 (migration applied)
- **US3+US4 (Phase 4)**: Starts after Phase 3 complete (T006 must exist before T007/T008 reference `setShowAdj`)
- **US5 (Phase 5)**: T009+T010 (backend-only) can run in parallel with Phase 3/4; T011 requires T003+T006 complete
- **Polish (Phase 6)**: Starts after all phases complete

### User Story Dependencies

- **US1 (P1)**: T002 → T003+T004 (parallel) → T005
- **US2 (P1)**: US1 complete → T006
- **US3 (P2)**: ≈ behavior implemented in T003 + T006; testable after Phase 4
- **US4 (P2)**: T006 complete → T007 → T008
- **US5 (P3)**: T009+T010 parallel (backend); T011 after T003+T006

### Parallel Opportunities

- T003 (ItemRow.tsx) ‖ T004 (EntryScreen.tsx) — different files, Phase 3
- T009 (queries.ts) ‖ T010 (pwa.ts) — different files, Phase 5
- T009+T010 can run during Phase 3/4 (backend-only, no UI dependency)

---

## Parallel Example: Phase 3

```
# Run in parallel (different files):
T003 — Rewrite pwa/src/components/ItemRow.tsx
T004 — Update EntryScreen.tsx state init

# Then sequentially:
T005 — Submit guard in EntryScreen.tsx
T006 — makeOnMax() in EntryScreen.tsx
```

## Parallel Example: Phase 5

```
# Run in parallel (different files):
T009 — Update backend/src/db/queries.ts
T010 — Update backend/src/handlers/pwa.ts

# Then:
T011 — Update submit payload in EntryScreen.tsx
```

---

## Implementation Strategy

### MVP (US1 Only)

1. T001–T002: Apply migration
2. T003–T005: Layout + submit guard
3. Validate: one pre-populated item, Max fills amountVal, submit blocked when empty

### Incremental Delivery

1. Phase 2 → migration live
2. Phase 3 → P1 stories pass (daily use case works)
3. Phase 4 → P2 stories pass (% discount users unblocked)
4. Phase 5 → P3 story passes (note round-trips)
5. Phase 6 → smoke test signs off

---

## Notes

- `makeOnMax()` implements the full formula (Σabs + Σpct gross-up) from the start — US1's simple case is the degenerate case of the same formula
- `approxFlag` lives in `ItemRowData` and is set by `makeOnMax()`; ItemRow renders `≈Max` without needing to know the formula
- Fee and refund tabs are out of scope — do not modify those form components
- ItemRow component props must remain stable (feature 019 reuses it unchanged)
