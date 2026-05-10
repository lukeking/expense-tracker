# Tasks: Auto-Create Item from Subcategory

**Input**: Design documents from `specs/007-item-from-subcategory/`  
**Prerequisites**: plan.md ✓, spec.md ✓

**Scope**: 2 files changed — `expense-parser.ts` (logic) + `expense-parser.test.ts` (tests). No setup, no schema changes, no new dependencies.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup & Foundational

*No tasks required — modifying an existing file with no new dependencies or infrastructure.*

---

## Phase 2: User Story 1 — Categorized Expense Without Redundant Item Entry (Priority: P1) 🎯 MVP

**Goal**: When `#category:subcategory` is present but no item tokens are parsed, `parseDescription()` auto-creates `{ name: subcategoryName, amount: totalAmount }` and returns it in the `items` array.

**Independent Test**: Run `pnpm test tests/services/expense-parser.test.ts` — all new and existing cases pass.

### Tests for User Story 1

- [X] T001 [US1] Add failing test cases for auto-create behavior in `backend/tests/services/expense-parser.test.ts`:
  - `#category:subcategory` only → items=[{name:subcategoryName, amount:totalAmount}]
  - `#category:subcategory` + free-text note, no items → auto-create fires
  - `#category:subcategory` + explicit item tokens → NO auto-create (explicit items win)
  - plain `#tag` only (no colon) → NO auto-create
  - empty subcategory `#food:` → NO auto-create
  - multiple category tags, no items → auto-create from first subcategory only

### Implementation for User Story 1

- [X] T002 [US1] Implement auto-create logic in `backend/src/services/expense-parser.ts` inside `parseDescription()`: after the parsing loop, if `items.length === 0` AND `categoryTag !== null` AND the part after `:` in categoryTag has length > 0, push `{ name: subcategoryName, amount: totalAmount }` to items. Run tests — all T001 cases must now pass.

**Checkpoint**: `pnpm test tests/services/expense-parser.test.ts` — all tests green, including all pre-existing cases.

---

## Phase 3: Polish & Cross-Cutting Concerns

- [X] T003 Run full test suite to verify zero regressions: `pnpm test` in `backend/` — all test files must pass.

---

## Dependencies & Execution Order

- **T001** → must be written before T002 (TDD: write failing tests first)
- **T002** → depends on T001 (implement until T001 passes)
- **T003** → depends on T002 (full suite regression check)

No parallel opportunities — sequential by design (TDD flow, single file).

---

## Implementation Strategy

### MVP (only scope)

1. Write failing tests (T001)
2. Implement logic (T002) — verify T001 tests now pass
3. Full regression check (T003)
4. Done — feature complete

---

## Notes

- The `categoryTag` field returned by `parseDescription()` is already in `"category:subcategory"` format. Extract subcategory with `categoryTag.split(':')[1]`.
- `totalAmount` is already the second argument of `parseDescription(description, totalAmount)`.
- Guard: `subcategoryName.trim().length > 0` to skip malformed tags like `#food:`.
- The auto-created item is structurally identical to manual items — no DB or handler changes needed.
