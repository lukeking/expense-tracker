# Tasks: Audit Edit History (020)

**Branch**: `020-audit-edit-history`  
**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelisable (different files, no incomplete dependencies)
- **[Story]**: US1 = View history, US2 = Capture on save, US3 = Immutability

---

## Phase 1: Foundational — Migration

**Purpose**: DB schema change that blocks all subsequent work.

- [x] T001 Write `backend/supabase/migrations/019_transaction_edit_history.sql` from `specs/020-audit-edit-history/contracts/schema-ddl.sql`
- [x] T002 Apply migration to dev Supabase — paste `backend/supabase/migrations/019_transaction_edit_history.sql` into Supabase Studio SQL Editor
- [x] T003 Verify: `SELECT * FROM transaction_edit_history LIMIT 1` returns empty result without error

**Checkpoint**: Table exists — backend work can begin.

---

## Phase 2: User Story 2 — History Captured on Save (P1)

**Goal**: Every successful expense save writes a history row with the before/after diff. No-op saves are skipped.

**Independent Test**: Edit a transaction, save, then query `SELECT * FROM transaction_edit_history` — one row exists with correct `transaction_id`, recent `edited_at`, and a `diff` containing the changed fields.

### Implementation

- [x] T004 [US2] Extend the `SELECT` in the PUT handler in `backend/src/handlers/pwa.ts` (line ~388) to also fetch `amount, payment_method, tags, note` from `transactions` in the same query that currently fetches `id, transaction_type, transaction_at`
- [x] T005 [P] [US2] Add `readItemsForDiff` helper in `backend/src/handlers/pwa.ts`: SELECT `name, amount, tags, note` from `transaction_items` WHERE `transaction_id = txId` ORDER BY `sort_order`
- [x] T006 [US2] Add `computeEditDiff(before, after)` function in `backend/src/handlers/pwa.ts` implementing the diff logic from `specs/020-audit-edit-history/data-model.md` — header field comparison (note null/empty equivalence, tag sort), items deep equality, adjustments deep equality; returns `null` when nothing changed
- [x] T007 [US2] In the PUT handler (`backend/src/handlers/pwa.ts`), after all validation and before the UPDATE call: call `readItemsForDiff`, call `getAdjustmentsForTransaction`, call `computeEditDiff`; after ALL write operations succeed (update + items replace + adjustments replace + effective amounts), if diff is non-null insert a row into `transaction_edit_history`

**Checkpoint**: POST to PUT endpoint with a change → `transaction_edit_history` row created. No-op PUT → no row created.

---

## Phase 3: User Story 1 — View Edit History (P1)

**Goal**: History entries returned in the GET endpoint and displayed in a collapsible section at the bottom of the edit sheet.

**Independent Test**: Open the edit sheet for a previously-edited transaction — a "編輯紀錄 (N)" section appears, expanding to show timestamps and before→after diffs for each edit.

### Implementation

- [x] T008 [US1] Extend `GET /pwa/transactions/:id` in `backend/src/handlers/pwa.ts` (line ~302): after fetching adjustments, query `transaction_edit_history` for `id, edited_at, diff` WHERE `transaction_id = txId` ORDER BY `edited_at ASC`; append as `history: []` to the JSON response
- [x] T009 [P] [US1] Add `EditDiff` TypeScript type in `pwa/src/components/EditExpenseSheet.tsx` mirroring the JSONB diff schema from `specs/020-audit-edit-history/data-model.md`; extend `TxDetail` type with `history: { id: string; edited_at: string; diff: EditDiff }[]`
- [x] T010 [P] [US1] Create `pwa/src/components/EditHistorySection.tsx`: props `{ history: TxDetail['history'] }`; renders nothing when `history.length === 0`; shows collapsed "編輯紀錄 (N)" toggle; each expanded entry shows `edited_at` formatted as `YYYY-MM-DD HH:mm` (local time) and a diff summary: one line per changed header field ("金額 100 → 120"), items count change ("品項: 2 → 3 項"), adjustments count change ("折抵: 0 → 1 筆")
- [x] T011 [US1] In `EditExpenseFormInner` in `pwa/src/components/EditExpenseSheet.tsx`, render `<EditHistorySection history={tx.history} />` between the Note field and the Save button

**Checkpoint**: Open edit sheet for edited transaction → history section visible with correct entries.

---

## Phase 4: User Story 3 — History Is Immutable (P2)

**Goal**: Confirm that all prior entries survive subsequent edits.

**Independent Test**: Edit the same transaction 3 times; re-open edit sheet; 3 entries visible oldest-first, none missing or altered.

- [x] T012 [US3] Manual verification: edit a transaction 3 times, verify 3 rows in `transaction_edit_history` for that `transaction_id`, all entries present and unmodified — no code change required; mark complete when verified

**Checkpoint**: Immutability confirmed — this is guaranteed by the append-only insert pattern (no UPDATE/DELETE in the code).

---

## Phase 5: Polish

- [x] T013 Run full smoke test per `specs/020-audit-edit-history/quickstart.md` Steps 1–6 using local dev servers (`wrangler dev` + `vite dev`)

---

## Dependencies & Execution Order

```
T001 → T002 → T003            (migration, must complete first)
T003 → T004, T005, T006       (backend work unblocked)
T004 + T005 + T006 → T007     (PUT handler capture, needs all three)
T007 → T008                   (GET must return history rows that exist)
T008 → T009, T010             (frontend types depend on knowing shape)
T009 + T010 → T011            (render depends on type + component)
T011 → T012                   (immutability test requires full stack)
T012 → T013                   (smoke test is final validation)
```

### Parallel opportunities

- T005 and T006 can be written in parallel (both are self-contained helpers).
- T009 and T010 can be written in parallel (types file and new component are independent files).

---

## Implementation Strategy

Complete phases in order: T001–T003 (migration) → T004–T007 (capture) → T008–T011 (display) → T012–T013 (verify).

MVP checkpoint after T007: history is being captured correctly in the DB even before the UI displays it.
