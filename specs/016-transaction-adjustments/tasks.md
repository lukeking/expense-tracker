# Tasks: Transaction Adjustments + Legacy Data Cleanup (016)

**Input**: Design documents from `specs/016-transaction-adjustments/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅, research.md ✅, contracts/schema-ddl.sql ✅

**Organization**: Tasks grouped by user story — each story independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no shared-state conflict)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in every task description

---

## Phase 1: Setup

*(No setup needed — existing project, branch already created.)*

---

## Phase 2: Foundational (Schema + Types + DB Helpers)

**Purpose**: Schema migrations and core TypeScript infrastructure that MUST be complete before any user story can be implemented.

**⚠️ CRITICAL**: All user story phases depend on Phase 2 completion.

- [ ] T001 Write `backend/supabase/migrations/015_transaction_adjustments.sql` — CREATE TABLE `transaction_adjustments`, ALTER TABLE `transaction_items` ADD COLUMN `effective_amount`, and backfill `effective_amount = amount` for all existing items (copy DDL from `contracts/schema-ddl.sql` Phase-A section)
- [ ] T002 Apply 015 migration to dev Supabase: `psql $DATABASE_URL -f backend/supabase/migrations/015_transaction_adjustments.sql` — verify table exists and `SELECT COUNT(*) FROM transaction_items WHERE effective_amount IS NULL AND amount IS NOT NULL` returns 0
- [ ] T003 Add `TransactionAdjustment` interface to `backend/src/types.ts` (fields: id, transaction_id, kind, amount, transaction_at, basis, basis_value, note, source, created_at, updated_at — copy from data-model.md TypeScript section)
- [ ] T004 Add `effective_amount: number | null` field to `TransactionItemRow` interface in `backend/src/types.ts`
- [ ] T005 Add `insertAdjustments(supabase, transactionId, adjustments[])` to `backend/src/db/queries.ts` — bulk insert into `transaction_adjustments`
- [ ] T006 Add `computeAndWriteEffectiveAmounts(supabase, transactionId, paidTotal)` to `backend/src/db/queries.ts` — reads items, applies floor+remainder distribution algorithm from plan.md §Phase B, bulk-updates `effective_amount` via upsert
- [ ] T007 Add `getAdjustmentsForTransaction(supabase, transactionId)` to `backend/src/db/queries.ts` — fetch all adjustment rows for a transaction (needed for edit flow)

**Checkpoint**: Schema applied, types defined, DB helpers available — user story work can begin.

---

## Phase 3: User Story 1 — Record a transaction with an order-level adjustment (Priority: P1) 🎯 MVP

**Goal**: User can add fee/refund/discount adjustments on the PWA entry and edit forms; adjustments are stored, `effective_amount` is recomputed, and category summary reflects the paid total.

**Independent Test**: Create a new transaction with two items (NT$300, NT$200) and a NT$50 discount. Verify: `transaction_adjustments` has 1 row; item 1 has `effective_amount = 150`, item 2 has `effective_amount = 100`; category summary shows NT$250, not NT$500.

### Implementation for User Story 1

- [ ] T008 [P] [US1] Create `pwa/src/components/AdjustmentRow.tsx` — props: `{ adj: AdjustmentRowData; onChange: (a: AdjustmentRowData) => void; onRemove: () => void }`; renders kind select (折扣/手續費/退款), amount input, note input, remove button
- [ ] T009 [P] [US1] Write `backend/supabase/migrations/016_summary_rpc_v2.sql` — `CREATE OR REPLACE FUNCTION` for both `get_category_totals` and `get_subcategory_totals` replacing `ti.amount` with `ti.effective_amount` (copy full SQL from `contracts/schema-ddl.sql` Phase-D section)
- [ ] T010 [US1] Add adjustments collapsible section to `pwa/src/screens/EntryScreen.tsx` — state: `adjustments: AdjustmentRowData[]`; `<details>` element below items list labeled "折抵 / 手續費 / 退款"; "+" button to add `AdjustmentRow`; client-side validation blocking save if computed total ≤ 0 (FR-018); include `adjustments` array in POST body
- [ ] T011 [US1] Update POST `/pwa/expense` handler in `backend/src/handlers/pwa.ts` — parse optional `adjustments` array from request body; after `insertTransactionItems`, call `insertAdjustments(supabase, txId, adjustments)` then `computeAndWriteEffectiveAmounts(supabase, txId, paidTotal)`
- [ ] T012 [US1] Update edit flow in `backend/src/handlers/pwa.ts` — load existing adjustments via `getAdjustmentsForTransaction`; display in same collapsible section on edit form; on save: delete all existing adjustments for the transaction, re-insert, recompute `effective_amount`
- [ ] T013 [US1] Apply 016 summary RPC migration to dev Supabase: `psql $DATABASE_URL -f backend/supabase/migrations/016_summary_rpc_v2.sql` — verify both functions exist and return results
- [ ] T014 [US1] Update `aggregateByCategory` and `aggregateBySubcategory` in `backend/src/services/summary.ts` — change `item.amount` to `item.effective_amount ?? item.amount` in both app-side aggregation paths (Discord summary commands use this path, not the RPC)

**Checkpoint**: User Story 1 complete — new transactions with adjustments work end-to-end, summary reflects paid amounts.

---

## Phase 4: User Story 2 — Legacy data cleanup: truthful analytics on existing records (Priority: P2)

**Goal**: Run the one-time migration script to fix all 015 audit anomalies — category tags moved to items, default items backfilled, fee/refund rows converted to adjustments, orphan tags fixed, sum mismatches corrected.

**Independent Test**: Run `tsx backend/scripts/audit-legacy.ts` before and after migration; verify `category_tag_on_transaction` drops from 15,157 → 0, `transactions_without_items` 6 → 0, `orphan_category_tag_on_item` 24 → 0, `items_sum_mismatch` 2 → 0.

### Implementation for User Story 2

- [ ] T015 [US2] Inspect the 24 `orphan_category_tag_on_item` rows in dev Supabase (`SELECT id, tags FROM transaction_items WHERE array_to_string(tags, ',') LIKE '%:%'` filtered to items with tags not in `categories`) — determine and document the `OLD_TAG → NEW_TAG` mapping for all 24; this mapping will be hard-coded in migrate-016.ts (D-005)
- [ ] T016 [US2] Inspect the 2 `items_sum_mismatch` transaction rows in dev Supabase — determine the correct item amounts and document the fix; these will be hard-coded case-by-case in migrate-016.ts (Phase C6)
- [ ] T017 [US2] Write `backend/scripts/migrate-016.ts` implementing all steps in order (C1 backfill-items-for-transactions-without-items, C2 migrate-category-tags-from-transactions-to-items, C3 convert-fee-refund-transactions-to-adjustments, C4 print-orphan-fee-refund-rows, C5 fix-orphan-tags-using-mapping-table from T015, C6 fix-items-sum-mismatch using corrections from T016, C7 final-recompute-pass); supports `--dry-run` flag; idempotent (use `ON CONFLICT DO NOTHING` / existence checks); SC-009: only touches `source = 'legacy_migration'` rows for C2
- [ ] T018 [US2] Run `tsx backend/scripts/migrate-016.ts --dry-run` against dev Supabase — review stdout output; confirm the 6 orphan fee/refund rows are printed and no data is modified
- [ ] T019 [US2] Run `tsx backend/scripts/migrate-016.ts` (live) against dev Supabase — run `tsx backend/scripts/audit-legacy.ts` and verify SC-001 (`category_tag_on_transaction = 0`), SC-002 (fee_refund_without_parent for rows with parents = 0), SC-003 (`transactions_without_items = 0`), SC-004 (`orphan_category_tag_on_item = 0`), SC-005 (`items_sum_mismatch = 0`)

**Checkpoint**: User Story 2 complete — all legacy anomalies resolved, historical category analytics accurate.

---

## Phase 5: User Story 3 — Audit script reflects the new data model (Priority: P3)

**Goal**: Rewrite the 015 audit script so the items-sum invariant uses `effective_amount`, add a new adjustment-sum invariant, and add a heuristic check for pre-016 fake-refund-as-discount rows.

**Independent Test**: Run `tsx backend/scripts/audit-legacy.ts` after migration — FR-010 rewritten check reports 0; new invariant reports 0; heuristic pattern check reports 0 or only the known orphan rows.

### Implementation for User Story 3

- [ ] T020 [US3] Rewrite the `items_sum_mismatch` check in `backend/scripts/audit-legacy.ts` (FR-015): new invariant is `SUM(items.effective_amount) + SUM(adj.amount WHERE kind='fee') - SUM(adj.amount WHERE kind IN ('refund','discount')) ≠ transaction.amount`; for transactions with no items having `effective_amount`, fall back to old `SUM(items.amount)` check
- [ ] T021 [US3] Add new audit invariant to `backend/scripts/audit-legacy.ts` (FR-016): detect transactions where adjustment rows and `effective_amount` values are internally inconsistent (`SUM(effective_amount) WHERE amount IS NOT NULL ≠ transaction.amount - SUM(fee adj) + SUM(refund/discount adj)`)
- [ ] T022 [US3] Add heuristic pattern check to `backend/scripts/audit-legacy.ts` (FR-017): flag transactions where `transaction_type = 'refund'`, `parent_transaction_id IS NOT NULL`, and (`amount % parent.amount IN (5, 10, 15, 20 pct)` OR `amount % 100 = 0`) AND `ABS(transaction_at - parent.transaction_at) < 5 minutes`

**Checkpoint**: User Story 3 complete — audit script correctly validates the 016 data model.

---

## Phase 6: Polish & Verification

- [ ] T023 Run `pnpm test` in `backend/` and verify all existing tests pass with no regressions
- [ ] T024 Run `tsx backend/scripts/audit-legacy.ts` and confirm SC-001 through SC-006 are all satisfied; note the 6 orphan fee/refund rows that require manual resolution (per spec Post-Migration Manual Steps)
- [ ] T025 Manual PWA smoke test per `specs/016-transaction-adjustments/quickstart.md` Steps 4–6 — verify new transaction with discount, edit with fee, summary screen totals

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: No dependencies — start immediately
- **US1 (Phase 3)**: Depends on Phase 2 completion (T001–T007 must be done)
  - T008 and T009 can start in parallel as soon as Phase 2 is done
  - T010 depends on T008; T011/T012 depend on T005/T006/T007; T013 depends on T009; T014 independent
- **US2 (Phase 4)**: Depends on Phase 2 (needs `computeAndWriteEffectiveAmounts` from T006 for C7); T015 and T016 can be done in parallel
- **US3 (Phase 5)**: Depends on Phase 4 completion (migration must have run so rewritten invariants can be validated); T020 and T021 can be started in parallel but are in the same file
- **Polish (Phase 6)**: Depends on all phases complete

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2 — no dependency on US2 or US3
- **US2 (P2)**: Starts after Phase 2 — no dependency on US1 or US3 (though US1's migration helpers are reused)
- **US3 (P3)**: Starts after US2 completes (requires migrated data to validate rewritten invariants)

### Parallel Opportunities

- T003/T004 (types.ts additions): sequential, same file
- T008 (AdjustmentRow.tsx) and T009 (016_summary_rpc_v2.sql): **parallel** — different files, no dependency
- T015 (inspect 24 orphan tags) and T016 (inspect 2 mismatch rows): **parallel** — different queries, no dependency
- T020 and T021 (audit-legacy.ts additions): same file — write sequentially

---

## Parallel Example: User Story 1 Start

```bash
# After Phase 2 completes, launch in parallel:
Task T008: Create pwa/src/components/AdjustmentRow.tsx
Task T009: Write backend/supabase/migrations/016_summary_rpc_v2.sql
Task T014: Update backend/src/services/summary.ts (independent of T008/T009)
```

## Parallel Example: User Story 2 Research

```bash
# Launch in parallel before writing migrate-016.ts:
Task T015: Inspect 24 orphan_category_tag_on_item rows → produce OLD_TAG → NEW_TAG mapping
Task T016: Inspect 2 items_sum_mismatch rows → produce case-by-case fix
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001–T007)
2. Complete Phase 3: User Story 1 (T008–T014)
3. **STOP and VALIDATE**: Create a test transaction with a discount; verify `effective_amount` and summary totals

### Incremental Delivery

1. Phase 2 → Foundation ready
2. Phase 3 → US1: New transactions with adjustments work; summary analytics correct for new data
3. Phase 4 → US2: Historical data fixed; category analytics accurate for all 15k+ records
4. Phase 5 → US3: Audit script validates the new model going forward
5. Phase 6 → Final verification

---

## Notes

- [P] = different files, no shared-state conflict — safe to parallelise
- Each user story delivers independently testable value
- `computeAndWriteEffectiveAmounts` is the single recompute point — never compute `effective_amount` inline elsewhere
- SC-009 hard constraint: migration must filter to `source = 'legacy_migration'` for C2 category-tag migration
- The 6 orphan fee/refund rows (no parent) are intentionally left untouched by the migration — see spec Post-Migration Manual Steps for resolution
- `transaction.amount >= 0` is enforced at the PWA layer (FR-018); DB `CHECK (amount > 0)` provides the floor
