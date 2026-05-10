# Tasks: Explicit Payment Method Option for /expense

**Input**: Design documents from `/specs/006-expense-payment-option/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/discord-expense-command.md ✅

**Organization**: Single user story (P1). No setup or foundational phases required — all infrastructure (DB column, PaymentMethod type, handler scaffolding) already exists.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup

*No setup required — project structure, dependencies, and DB schema are already in place.*

---

## Phase 2: Foundational

*No blocking prerequisites — `PaymentMethod` type, `transactions.payment_method` column, and `handleExpenseCommand` scaffolding all exist.*

---

## Phase 3: User Story 1 — Record Expense with Explicit Payment Method (Priority: P1) 🎯 MVP

**Goal**: The `/expense` Discord command presents a `payment_method` dropdown with 5 choices; the handler uses the selected value (defaulting to `cash`) instead of Gemini keyword extraction; the confirmation message displays the Chinese label inline.

**Independent Test**: Run `/expense amount:300 description:#食:午餐, 麥當勞 大麥克套餐 250 payment_method:信用卡` and verify: (1) the stored `payment_method` is `credit_card`, (2) the confirmation shows `$300 [信用卡]`, (3) the description is not inspected for payment keywords.

### Implementation for User Story 1

- [x] T001 [P] [US1] Update `/expense` command in `backend/scripts/register-commands.ts`: change description from "記錄一筆現金支出" → "記錄一筆支出"; add `payment_method` option (type 3, required false) with 5 choices: 現金/cash, 信用卡/credit_card, 悠遊卡/easy_card, 銀行轉帳/bank_account, 行動支付/prepaid_wallet
- [x] T002 [P] [US1] Update `handleExpenseCommand` in `backend/src/handlers/discord.ts`: (a) read `payment_method` option from Discord options before the async block, defaulting to `'cash'`; (b) add module-level `PAYMENT_METHOD_LABEL` map (Record<PaymentMethod, string>) with all 5 Chinese labels; (c) pass `paymentMethod` to `insertTransaction` instead of `parsed.payment_method`; (d) append `[${PAYMENT_METHOD_LABEL[paymentMethod]}]` inline on the `💰 金額：$${amount}` line of the confirmation message
- [x] T003 [P] [US1] Update `backend/src/services/gemini.ts`: rename `COMMON_PROMPT_RULES` → `ANDROID_PROMPT_RULES`; create `DISCORD_PROMPT_RULES` (same content minus the payment_method mapping block); update `SYSTEM_PROMPT` (Discord flow) to use `DISCORD_PROMPT_RULES`; leave `RAW_TEXT_SYSTEM_PROMPT` using `ANDROID_PROMPT_RULES` unchanged
- [x] T004 [US1] Update `backend/tests/handlers/discord.test.ts`: add `payment_method: 'credit_card'` to the `/expense` options fixture; assert the response is type 5 (deferred); add a second test case where `payment_method` is omitted and assert it defaults to `cash` (verify via `insertTransaction` mock call args)
- [x] T005 [US1] Update `backend/tests/services/gemini.test.ts`: in the `parseExpenseText` (Discord flow) suite, add a test asserting that passing `description: '信用卡'` returns `payment_method: 'cash'` (no longer extracted from keywords); verify existing `parseRawExpenseText` tests for payment_method mapping still pass unchanged

**Checkpoint**: After T001–T005, the full user story is complete:
- `register-commands.ts` ready to re-register with 5-choice dropdown
- `handleExpenseCommand` reads and stores the Discord option value; confirmation shows `[支付方式]` label
- `parseExpenseText` no longer classifies description tokens as payment methods
- Tests pass for both the handler and the updated Gemini prompt

---

## Phase 4: Polish & Cross-Cutting Concerns

- [x] T006 Run test suite to confirm all existing tests pass: `cd backend && pnpm test`
- [x] T007 [P] Verify TypeScript compiles cleanly: `cd backend && pnpm tsc --noEmit`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 3** (User Story 1): No prior phase prerequisites — start immediately
- **Phase 4** (Polish): Depends on all Phase 3 tasks complete

### Within User Story 1

- **T001, T002, T003**: Fully independent (different files) — run in parallel
- **T004**: Depends on T002 (Discord handler changes needed before handler tests)
- **T005**: Depends on T003 (Gemini prompt changes needed before Gemini tests)
- **T006, T007**: Depend on T001–T005 all complete

---

## Parallel Execution Example

```bash
# T001, T002, T003 — all independent, launch together:
Task: "Update register-commands.ts: add payment_method option to /expense"
Task: "Update handleExpenseCommand in discord.ts: read option, add label map, update message"
Task: "Update gemini.ts: split COMMON_PROMPT_RULES into Discord/Android variants"

# After T002 and T003 complete, launch in parallel:
Task: "Update discord.test.ts: add payment_method fixtures and assertions"
Task: "Update gemini.test.ts: verify parseExpenseText no longer extracts payment from description"
```

---

## Implementation Strategy

### MVP (this feature IS the MVP — single story)

1. Complete T001, T002, T003 in parallel
2. Complete T004, T005
3. Complete T006, T007 (validate)
4. Re-register Discord commands after deployment: `npx tsx scripts/register-commands.ts`

### Post-Deployment Checklist

- [ ] Re-register Discord commands (manual step: `DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npx tsx scripts/register-commands.ts`)
- [ ] Verify `/expense` in Discord shows the `payment_method` dropdown with 5 labelled choices
- [ ] Test: omit `payment_method` → confirmation shows `[現金]`
- [ ] Test: select `信用卡` → confirmation shows `[信用卡]`; DB stores `credit_card`

---

## Notes

- [P] tasks = different files, no shared state dependencies
- No DB migration needed — `payment_method` column with CHECK constraint already exists
- Android path (`parseRawExpenseText`, `android.ts`) is **not touched** by any task
- `description` option remains required and unchanged on the `/expense` command
