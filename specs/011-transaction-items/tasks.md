# Tasks: Transaction Items Table

**Input**: Design documents from `specs/011-transaction-items/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/discord-commands.md ✅, quickstart.md ✅

**Tests**: Not requested — validation via quickstart.md steps.

**Organization**: Tasks grouped by user story to enable independent implementation and validation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on sibling tasks)
- **[Story]**: Which user story this task belongs to
- All paths are relative to the repo root

---

## Phase 1: Setup

**Purpose**: Schema migration only. Establishes the new table and removes the JSONB column. All subsequent phases depend on this.

- [X] T001 Write migration `backend/supabase/migrations/008_transaction_items.sql` — `CREATE TABLE transaction_items (id UUID PK, transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE, name TEXT NOT NULL, amount INTEGER NULL, tags TEXT[] NOT NULL DEFAULT '{}', sort_order INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ DEFAULT now())`, plus `CREATE INDEX idx_transaction_items_transaction_id ON transaction_items (transaction_id)`, plus `ALTER TABLE transactions DROP COLUMN items`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Type system, DB query layer, and summary aggregation updated. Every user story depends on all four tasks here.

**⚠️ CRITICAL**: No user story work can begin until T002–T005 are all complete.

- [X] T002 Update `backend/src/types.ts` — add `TransactionItemRow` interface (`id, transaction_id, name, amount: number|null, tags: string[], sort_order, created_at`); add `tags?: string[]` to the item shape inside `GeminiParseResult.items`; remove the `items` field from the `Transaction` interface entirely
- [X] T003 [P] Add `insertTransactionItems(supabase, transactionId, items: {name, amount?|null, tags?, sort_order?}[])` to `backend/src/db/queries.ts` — bulk insert into `transaction_items`; no-op if array is empty; validate non-null amounts are > 0 before insert
- [X] T004 [P] Update `getTransactionsForPeriod` in `backend/src/db/queries.ts` — change `.select('id, amount, tags, transaction_at')` to `.select('id, amount, tags, transaction_at, transaction_items(amount, tags)')` so Supabase returns items nested via the FK relationship; update the return type accordingly
- [X] T005 Rewrite `aggregateByCategory` and `aggregateBySubcategory` in `backend/src/services/summary.ts` — both functions now receive transactions with nested `transaction_items[]`; for each transaction: sum amounts on items that have a non-null amount and a `category:subcategory` tag → allocate to their category; `transaction.amount - categorisedSum` goes to `其他`; transactions with no categorised items → full amount to `其他`; `aggregateBySubcategory` filters items whose first tag starts with `${category}:`

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 — Single-Category Entry Non-Regression (Priority: P1) 🎯 MVP

**Goal**: `/expense`, `/fee`, `/refund` continue to work identically from the user's perspective. Items are written to `transaction_items` instead of the dropped JSONB column. `/summary` shows the same category totals as before.

**Independent Test**: Quickstart steps 1–2 (single `/expense 120 #食:午餐 便當`). Verify `transaction_items` has one row with amount=120 and tags=[食:午餐]. Verify `transactions.tags` is empty (no category tag). Verify `/summary month` shows 食: NT$120.

- [X] T006 [US1] Update `insertTransaction` in `backend/src/db/queries.ts` — remove the `items` field from the data object passed to `.insert()`; the function signature still accepts `items` parameter (used by callers to pass to `insertTransactionItems`) but does not write it to the transactions table
- [X] T007 [US1] Update `handleExpenseCommand` in `backend/src/handlers/discord.ts` — after `insertTransaction` succeeds, call `insertTransactionItems(supabase, transaction.id, items)` where each item carries `tags: [parsed.categoryTag]` (single-item implicit case) or item-specific tags (multi-item); set transaction `tags` to `parsed.plainTags` only (no categoryTag on the transaction itself); update Discord confirmation message to read item names from `transaction.transaction_items` if present
- [X] T008 [P] [US1] Update `handleFeeOrRefundCommand` in `backend/src/handlers/discord.ts` — after `insertTransaction`, call `insertTransactionItems(supabase, transaction.id, [{name: description, amount, tags: []}])` for the single item; remove `items` from the `insertTransaction` call
- [X] T009 [US1] Update `findParentCandidates` in `backend/src/db/queries.ts` — replace `items` from the `.select()` string (no longer on transactions) with `transaction_items(name)`; update the keyword filter to check nested item names: `row.transaction_items?.some(i => i.name.toLowerCase().includes(lower))` alongside the existing `note` check; update `handleAmendSelect` display in `backend/src/handlers/discord.ts` to read `txRow.transaction_items?.[0]?.name` instead of `txRow.items?.[0]?.name`

**Checkpoint**: Quickstart steps 1–2 pass. `/summary month` correct. Re-run validates zero regression on all three commands.

---

## Phase 4: User Story 5 — /amend Cascade (Priority: P1)

**Goal**: `/amend` on a single-item transaction updates both `transactions.amount` and the one `transaction_items` row in a single command. Multi-item amend warns rather than silently creating an inconsistency.

**Independent Test**: Quickstart steps 5–6. Record single-item expense of NT$100, amend to NT$110 — both fields update. Then amend the multi-item transaction from quickstart step 3 — warning appears, only transaction.amount changes.

- [X] T010 [US5] Add `getTransactionWithItems(supabase, txId)` to `backend/src/db/queries.ts` — select `amount` and nested `transaction_items(id, amount)` for a single transaction by id; used to read the item state before deciding cascade behaviour
- [X] T011 [P] [US5] Add `updateTransactionItemAmount(supabase, itemId, newAmount)` to `backend/src/db/queries.ts` — `UPDATE transaction_items SET amount = $newAmount WHERE id = $itemId`
- [X] T012 [US5] Update `handleAmendSelect` in `backend/src/handlers/discord.ts` — before calling `amendTransactionAmount`, call `getTransactionWithItems`; if exactly one item and its amount equals the old transaction amount → call `updateTransactionItemAmount` on that item after `amendTransactionAmount`; if multiple items with any non-null amounts → append `⚠️ 項目金額需手動更新` to confirmation message; if items all have null amounts → update transaction only with no warning

**Checkpoint**: Quickstart steps 5–6 pass.

---

## Phase 5: User Story 2 — Multi-Item Known Split (Priority: P1)

**Goal**: A comma-separated Discord entry with per-item `#category:subcategory` tags writes each item with its own category. `/summary` breaks the spend across the correct categories with no double-counting.

**Independent Test**: Quickstart step 3 (`/expense 180 全家,#食:早餐 便當 60,#醫:藥 感冒藥 120`). Verify two `transaction_items` rows, verify `/summary month` shows 食: NT$60, 醫: NT$120, no 全家 amount in 其他.

- [X] T013 [US2] Extend `parseDescription` in `backend/src/services/expense-parser.ts` — when a comma-token starts with `#category:subcategory` (tag body contains `:`), treat the remainder of the token as a line item and assign `tags: [tagBody]` to that item; a bare `#category:subcategory` token (nothing after the tag) still produces the implicit single-item from the subcategory name with the full total and `tags: [tagBody]`; update `ParsedDescription.items` type to include `tags: string[]`; update the implicit-single-item path to also set `tags: [categoryTag]`
- [X] T014 [US2] Update `handleExpenseCommand` in `backend/src/handlers/discord.ts` — propagate `parsed.items[n].tags` through to `insertTransactionItems`; `transactions.tags` = `parsed.plainTags` only (already done in T007, but verify multi-item path is covered)
- [X] T015 [P] [US2] Update Gemini prompt and schema in `backend/src/services/gemini.ts` — add `"tags": {"type": "array", "items": {"type": "string"}}` to the items object schema in `COMMON_PROMPT_RESPONSE_FORMAT`; add rule to `DISCORD_PROMPT_RULES` and `ANDROID_PROMPT_RULES`: "a `#category:subcategory` token immediately before an item name applies to that item's tags, not the overall transaction"; update `parseRawExpenseText` and `parseExpenseText` to pass through per-item tags in the returned `GeminiParseResult`

**Checkpoint**: Quickstart step 3 passes. Quickstart step 2 still passes (non-regression).

---

## Phase 6: User Story 3 — Unknown Split Falls to 其他 (Priority: P2)

**Goal**: Items entered without amounts are stored with `amount = NULL`. The full transaction amount appears under `其他` in summary until amounts are provided.

**Independent Test**: Quickstart step 4 (`/expense 237 全家,#食:零食 零食,#住:日用品 日用品` with no amounts). Verify `transaction_items.amount IS NULL` for both items. Verify `/summary month` shows 237 under 其他.

- [X] T016 [US3] Validate null-amount path in `backend/src/services/expense-parser.ts` — when `parseDescription` parses a `#category:subcategory name` token with no trailing number, the item is created with `amount: undefined` (not 0); update `insertTransactionItems` in `backend/src/db/queries.ts` to pass `null` (not 0) for undefined/missing amounts; confirm the 其他 fallback in `aggregateByCategory` (T005) activates correctly for null-amount items

**Checkpoint**: Quickstart step 4 passes.

---

## Phase 7: User Story 4 — Invoice Import Populates Item Amounts (Priority: P2)

**Goal**: After an invoice is matched to a transaction, invoice line items are written to `transaction_items` with their amounts. Summary subsequently shows per-category spend for that transaction.

**Independent Test**: Quickstart step 7. Match an invoice to a transaction with null-amount items. Verify item amounts are populated from invoice lines. Verify `/summary month` now shows amounts under correct categories.

- [X] T017 [US4] Add `getTransactionItems(supabase, transactionId)` to `backend/src/db/queries.ts` — `SELECT * FROM transaction_items WHERE transaction_id = $id ORDER BY sort_order`
- [X] T018 [P] [US4] Add `replaceTransactionItems(supabase, transactionId, items[])` to `backend/src/db/queries.ts` — `DELETE FROM transaction_items WHERE transaction_id = $id` then bulk insert new items; used when invoice item count differs from existing transaction items
- [X] T019 [US4] Update the invoice match handler in `backend/src/handlers/discord.ts` — after a transaction↔invoice match is confirmed: call `getTransactionItems`; if any items have `amount IS NULL` and invoice has line items: populate amounts in order via `updateTransactionItemAmount` (T011); if item count differs from invoice item count: send a Discord warning listing the discarded item names (format: `⚠️ 發票項目與記錄不符，以下項目將被取代：\n  · <name>\n...`), then call `replaceTransactionItems` with invoice line items mapped to `{name, amount, tags: [], sort_order}`; if all items already have amounts: skip without modifying items

**Checkpoint**: Quickstart step 7 passes.

---

## Phase 8: Polish & Validation

**Purpose**: Final validation and any cross-cutting cleanup.

- [ ] T020 [P] Apply migration `008_transaction_items.sql` to the Supabase instance; drop existing test data from `transactions` and re-seed with a clean entry via `/expense` to confirm the new schema works end-to-end
- [ ] T021 Run all quickstart.md validation steps 1–7 in order; confirm all pass before marking feature complete

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — T001 starts immediately
- **Phase 2 (Foundational)**: Requires Phase 1 complete — T002–T005 block all user stories; T003 and T004 are parallel with each other
- **Phase 3 (US1)**: Requires Phase 2 complete; T007 depends on T006; T008 is parallel with T007; T009 is parallel with T007/T008
- **Phase 4 (US5)**: Requires Phase 3 complete (needs items in `transaction_items` to cascade); T010 and T011 parallel
- **Phase 5 (US2)**: Requires Phase 3 complete; T013 before T014; T015 parallel with T013/T014
- **Phase 6 (US3)**: Requires Phase 5 complete (null-amount path flows through same parser)
- **Phase 7 (US4)**: Requires Phase 3 complete; T018 parallel with T017
- **Phase 8 (Polish)**: Requires all prior phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational. MVP core.
- **US5 (P1)**: Depends on US1 (items must exist to cascade). Pair with US1.
- **US2 (P1)**: Depends on Foundational + US1 (extends same parser and handler). Third P1 story.
- **US3 (P2)**: Depends on US2 (null-amount path goes through same parser extension).
- **US4 (P2)**: Depends on US1 only (invoice match handler is separate from parser changes).

### Within Each Phase

- T003 and T004 (Foundational) touch different functions — parallel
- T008 (US1) touches a different handler function than T007 — parallel after T006
- T011 (US5) is parallel with T010
- T015 (US2) touches `gemini.ts` only — parallel with T013/T014 in `expense-parser.ts`/`discord.ts`
- T018 (US4) parallel with T017

---

## Parallel Execution Examples

### Phase 2 (Foundational)

```
T002 alone first (type changes needed by T003/T004)
Then in parallel:
  Task: "Add insertTransactionItems to queries.ts" (T003)
  Task: "Update getTransactionsForPeriod nested select" (T004)
Then:
  Task: "Rewrite aggregateByCategory + aggregateBySubcategory" (T005)
```

### Phase 3 (US1)

```
T006 first (removes items from insertTransaction payload)
Then in parallel:
  Task: "Update handleExpenseCommand to write items" (T007)
  Task: "Update handleFeeOrRefundCommand to write items" (T008)
  Task: "Update findParentCandidates and amend display" (T009)
```

### Phase 5 (US2)

```
In parallel:
  Task: "Extend parseDescription for per-item category tags" (T013)
  Task: "Update Gemini prompt and schema for per-item tags" (T015)
Then:
  Task: "Update handleExpenseCommand to pass item tags" (T014)
```

---

## Implementation Strategy

### MVP First (US1 + US5)

1. Complete Phase 1 (Setup) — apply migration
2. Complete Phase 2 (Foundational) — types, queries, summary rewrite
3. Complete Phase 3 (US1) — non-regressive single-category entry
4. Complete Phase 4 (US5) — amend cascade
5. **STOP and VALIDATE**: Quickstart steps 1–2, 5–6. All original flows work.

### Full Delivery

6. Complete Phase 5 (US2) — multi-item known split → quickstart step 3
7. Complete Phase 6 (US3) — null amounts → quickstart step 4
8. Complete Phase 7 (US4) — invoice import fills amounts → quickstart step 7
9. Complete Phase 8 (Polish) — full quickstart run

---

## Notes

- [P] tasks touch different functions or files — safe to run simultaneously
- `transactions.items` JSONB is dropped in T001; any code still referencing it will fail compilation — use TypeScript errors as a guide to find all call sites
- The implicit single-item path in `parseDescription` (when only a bare `#category:subcategory` tag is present) must carry `tags: [categoryTag]` onto the created item — this is the most critical backwards-compatibility invariant
- Test data will be dropped as part of T020; no backward migration is needed
