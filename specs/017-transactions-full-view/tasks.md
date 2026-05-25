# Tasks: Transactions Full View (017)

**Input**: Design documents from `specs/017-transactions-full-view/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/schema-ddl.sql ✓

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1)

---

## Phase 1: Setup

**Purpose**: Confirm migration directory exists and is ready.

- [ ] T001 Confirm `backend/supabase/migrations/` directory exists (no file creation needed)

---

## Phase 2: User Story 1 — Query Full Transaction Data (Priority: P1) 🎯

**Goal**: Create `v_transactions_full` view so developers can query a complete transaction picture — header, items, adjustments — in one row.

**Independent Test**: Run verification queries from `specs/017-transactions-full-view/quickstart.md` against dev Supabase and confirm all 4 checks pass (row count, array shapes, null safety, write rejection).

### Implementation

- [ ] T002 [US1] Write migration `backend/supabase/migrations/017_transactions_full_view.sql` using DDL from `specs/017-transactions-full-view/contracts/schema-ddl.sql`
- [ ] T003 [US1] Apply migration to dev Supabase: `psql $DATABASE_URL -f backend/supabase/migrations/017_transactions_full_view.sql`

### Verification (quickstart.md Steps 1–4)

- [ ] T004 [US1] Verify row count: `SELECT COUNT(*) FROM v_transactions_full` equals `SELECT COUNT(*) FROM transactions`
- [ ] T005 [US1] Verify items array: query a transaction with items and confirm `items` is a non-empty JSON array with correct shape
- [ ] T006 [US1] Verify empty arrays: confirm transactions with no items return `items = []` (not NULL)
- [ ] T007 [US1] Verify read-only: attempt INSERT into view and confirm database rejects it

**Checkpoint**: All 4 verification queries pass — feature is complete and shippable.

---

## Phase 3: Polish & Commit

- [ ] T008 Commit migration file to branch `017-transactions-full-view`

---

## Dependencies & Execution Order

- **T001**: No dependencies — start immediately
- **T002**: Depends on T001
- **T003**: Depends on T002
- **T004–T007**: All depend on T003; can run in parallel (all are read queries)
- **T008**: Depends on T004–T007 all passing

### Parallel Opportunities

```
T004, T005, T006, T007 — run simultaneously once T003 completes
```

---

## Implementation Strategy

Single-increment delivery — this feature is one file:

1. Write migration (T002)
2. Apply to dev Supabase (T003)
3. Verify all 4 checks (T004–T007)
4. Commit (T008)

Total: 8 tasks, ~10 minutes end-to-end.
