# Tasks: Discord Fee & Refund Commands

**Input**: Design documents from `specs/003-discord-fee-refund/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Organization**: Tasks grouped by user story. US1 (fee) and US2 (refund) are both P1 and share a common foundational phase.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files or non-overlapping code paths)
- **[Story]**: Which user story this task belongs to (US1 = fee, US2 = refund)

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Infrastructure that MUST be complete before either user story can work correctly.

**⚠️ CRITICAL**: Both user stories depend on the query layer and the corrected budget formula.

- [x] T001 Fix `getMonthlySpend` in `backend/src/db/queries.ts` — change `.select('amount')` to `.select('amount, transaction_type')`; change the reduce to `row.transaction_type === 'refund' ? sum - amount : sum + amount`. Implements `Σ(expense) + Σ(fee) − Σ(refund)` from FR-007.

- [x] T002 Add `findParentCandidates(supabase, searchTerm, windowDays)` in `backend/src/db/queries.ts` — query `transactions` where `transaction_type='expense'`, `transaction_at >= now() - windowDays days`, and `items::text ILIKE '%searchTerm%' OR note ILIKE '%searchTerm%'`; order by `transaction_at DESC`, limit 5; return `Transaction[]`.

**Checkpoint**: `getMonthlySpend` correctly nets out refunds; `findParentCandidates` returns matching expenses — both user stories can now be implemented.

---

## Phase 2: User Story 1 — Record a Foreign Transaction Fee (Priority: P1) 🎯 MVP

**Goal**: `/fee amount:N [description:...] [parent:...]` inserts a `fee` transaction, optionally prompts with candidate buttons, and always saves — linked or unlinked.

**Independent Test**: Insert an expense for NT$1,200 "Airbnb". Run `/fee amount:180 parent:Airbnb`. Verify a `fee` row exists in Supabase with `amount=180`, `transaction_type='fee'`, `parent_transaction_id=<Airbnb UUID>`. Verify the original NT$1,200 row is unchanged.

- [x] T003 [US1] Add `handleFeeCommand(c, interaction)` in `backend/src/handlers/discord.ts` — extract `amount` (required int), `description` (optional, default `"國外交易服務費"`), `parent` (optional search term); validate `amount > 0`; return type 5 deferred; inside `waitUntil`: insert fee transaction with `transaction_type: 'fee'`, `payment_method: 'credit_card'`, `items: [{name: description, amount}]`, `parent_transaction_id: null`; if `parent` provided call `findParentCandidates` and patch with button message or "no match" confirmation; if `parent` omitted patch with unlinked confirmation + budget. See `contracts/discord-fee-refund-commands.md` for message formats and button layout.

- [x] T004 [US1] Extend `handleComponentInteraction` in `backend/src/handlers/discord.ts` to handle `fee_link:{fee_tx_id}:{parent_tx_id}` and `fee_unlink:{fee_tx_id}` prefixes — for `fee_link`: parse both UUIDs from `custom_id`, `UPDATE transactions SET parent_transaction_id = {parent_tx_id} WHERE id = {fee_tx_id}`, fetch budget, return type 4 confirmation `"✅ 費用已連結！\n💰 NT$X · 描述\n🔗 已連結至：...\n📊 本月支出：..."`. For `fee_unlink`: fetch budget only (no DB write), return type 4 `"✅ 費用已儲存（未連結）\n..."`.

**Checkpoint**: `/fee` command fully functional — inserts row, shows candidates when `parent` provided, links on button click. User Story 1 independently testable.

---

## Phase 3: User Story 2 — Record a Refund or Reimbursement (Priority: P1)

**Goal**: `/refund amount:N [description:...] [parent:...]` inserts a `refund` transaction with identical flow to `/fee` and correctly decreases net spend in the budget summary.

**Independent Test**: Insert an expense for NT$800 "高鐵票". Run `/refund amount:800 parent:高鐵`. Verify a `refund` row exists with `amount=800`, `transaction_type='refund'`, `parent_transaction_id=<ticket UUID>`. Verify budget summary shows spend reduced by NT$800.

- [x] T005 [P] [US2] Add `handleRefundCommand(c, interaction)` in `backend/src/handlers/discord.ts` — identical flow to `handleFeeCommand` with: `transaction_type: 'refund'`, `payment_method: 'cash'`, default description `"退款"`. This function is parallel-safe with T003 (separate function, no shared state).

- [x] T006 [US2] Extend `handleComponentInteraction` in `backend/src/handlers/discord.ts` to handle `refund_link:{fee_tx_id}:{parent_tx_id}` and `refund_unlink:{fee_tx_id}` — same logic as T004 but for refund prefixes; confirmation messages use `"✅ 退款已連結！"` / `"✅ 退款已儲存（未連結）"`. (Must follow T004 to avoid conflicts in the same switch block.)

**Checkpoint**: `/refund` command fully functional. Both user stories work; net spend correctly decreases after a refund is recorded.

---

## Phase 4: Command Registration

**Purpose**: Make `/fee` and `/refund` visible in Discord's slash command picker.

- [x] T007 [P] Add `/fee` and `/refund` command definitions to `backend/scripts/register-commands.ts` — add the two command objects from `contracts/discord-fee-refund-commands.md` to the commands array: `/fee` with `amount` (INTEGER, required, min_value:1), `description` (STRING, optional), `parent` (STRING, optional); `/refund` with identical structure and Chinese descriptions for refund context. This task is independent of Phases 2–3 and can be done in parallel.

**Checkpoint**: After `pnpm deploy && pnpm register-commands`, both commands appear in Discord's `/` picker.

---

## Phase 5: Tests

**Purpose**: Automated verification of the budget fix and command handler behavior.

- [x] T008 Add `getMonthlySpend` sign-correction tests to `backend/tests/db/queries.test.ts` (create file if absent) — three cases: (a) refund row reduces net spend: `expense(1000) + refund(200) = 800`; (b) fee row increases net spend: `expense(1000) + fee(50) = 1050`; (c) mixed formula: `expense(1000) + fee(50) + refund(200) = 850`. Mock Supabase to return rows with `{amount, transaction_type}`.

- [x] T009 [P] Add fee/refund command handler tests to `backend/tests/handlers/discord.test.ts` — cases: (a) `/fee` returns type 5 deferred immediately; (b) `fee_link` `custom_id` decodes both UUIDs correctly; (c) button label format `NT$1,200 · 04/30 14:23` (UTC+8, HH:MM); (d) `amount <= 0` returns inline error before deferred; (e) `parent` omitted → unlinked confirmation shape (no buttons); (f) `findParentCandidates` returns empty → "no match" message shape; (g) refund command symmetry with fee (type, payment_method defaults, description default).

**Checkpoint**: All tests pass (`pnpm test`). Budget formula and command response shapes verified.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: No dependencies — start immediately
- **US1 (Phase 2)**: Depends on T001 (budget formula) and T002 (query) — BLOCKS until Phase 1 complete
- **US2 (Phase 3)**: Same as US1 — depends on Phase 1 completion; T006 must follow T004 (shared function)
- **Registration (Phase 4)**: Independent — can run in parallel with Phases 2–3
- **Tests (Phase 5)**: Depends on Phases 1–3 complete

### Task-Level Dependencies

```
T001 → T003, T004, T005, T006   (budget summary used in all confirmations)
T002 → T003, T005               (findParentCandidates called from both command handlers)
T003 → T004                     (component handler must know fee_link/fee_unlink format)
T004 → T006                     (extend same switch block — avoid merge conflicts)
T005 → T006                     (parallel with T003 but T006 must follow T004)
T001–T006 → T008, T009          (tests verify final behavior)
T007: independent               (command definitions don't depend on handler impl)
```

### Parallel Opportunities

- **T001 + T002**: Different lines in the same file — can be batched in one implementation pass
- **T003 + T005**: Different functions in the same file — can be parallel (different subagents or sequential pass)
- **T007**: Independent of all handler work — can run anytime after Phase 1
- **T008 + T009**: Both test files — can run in parallel after all implementation is done

---

## Parallel Example: Phase 2 + Phase 3

```bash
# T003 and T005 touch different functions — safe to implement in one pass:
# handleFeeCommand() — new function
# handleRefundCommand() — new function (parallel)

# T004 and T006 both extend handleComponentInteraction — do sequentially:
# Add fee_link / fee_unlink branches → then add refund_link / refund_unlink branches
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (T001, T002) — foundation ready
2. Complete Phase 2 (T003, T004) — `/fee` fully working
3. **STOP and VALIDATE**: Run smoke tests from quickstart.md for `/fee`
4. Deploy + register commands (`pnpm deploy && pnpm register-commands`)

### Incremental Delivery

1. T001 + T002 → foundation (15 min)
2. T003 + T004 → `/fee` end-to-end (30 min) → smoke test → deploy
3. T005 + T006 → `/refund` end-to-end (20 min) → smoke test → deploy
4. T007 + T008 + T009 → test coverage (20 min)

### Full Execution Order (Single Pass)

```
T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009
                                                (T007 can slide anywhere)
```
