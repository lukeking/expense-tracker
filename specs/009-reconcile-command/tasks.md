# Tasks: Standalone Invoice Reconciliation Command

**Input**: Design documents from `specs/009-reconcile-command/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/discord-reconcile.md ✅, quickstart.md ✅

**Tests**: Included — quickstart.md explicitly lists expected test coverage.

**Organization**: No schema changes. No new directories. All work extends existing files in `backend/src/` and `backend/tests/`.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1, US2)
- Exact file paths in every description

---

## Phase 1: Setup

**Purpose**: Register the new Discord command (prerequisite for all Discord interaction testing).

- [x] T001 Append `/reconcile` command object to the `commands` array in `backend/scripts/register-commands.ts` — `{ name: 'reconcile', description: '重新比對所有待確認發票（外幣/模糊）' }`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: New DB query and updated service interface that both US1 and US2 depend on.

**⚠️ CRITICAL**: US1 and US2 implementation cannot begin until this phase is complete.

- [x] T002 [P] Add `findAllAmbiguousInvoices(supabase)` to `backend/src/db/queries.ts` — `SELECT * FROM invoices WHERE match_status = 'ambiguous' ORDER BY invoice_date ASC`, returns `Invoice[]`, parallel to existing `findAllHeldForexInvoices`
- [x] T003 [P] Define `ReconciliationResult` interface and update `runReconciliationPass` return type from `Promise<number>` to `Promise<ReconciliationResult>` in `backend/src/services/invoice-matcher.ts` — interface fields: `forexResolved: number`, `ambiguousAutoResolved: number`, `ambiguousRemaining: Invoice[]`
- [x] T004 Update `runImportPipeline` call site in `backend/src/services/invoice-matcher.ts` to destructure `{ forexResolved }` from the new `ReconciliationResult` return value (existing summary only uses this field)

**Checkpoint**: Foundation ready — US1 and US2 implementation can now begin.

---

## Phase 3: User Story 1 — Auto-Reconciliation Pass (Priority: P1) 🎯 MVP

**Goal**: `/reconcile` triggers the full reconciliation pass (held_forex + ambiguous with 1 candidate auto-linked), returns a deferred Discord summary, and sends sequential prompts for any remaining ambiguous invoices.

**Independent Test**: With a corrected `held_forex` invoice in the database, run `/reconcile`. Verify Discord shows "thinking..." immediately, the follow-up summary reports the resolved count, and the invoice `match_status` is now `matched`.

### Tests for User Story 1

- [x] T005 [P] [US1] Extend `backend/tests/services/invoice-matcher.test.ts` with tests for the ambiguous invoice loop — 1 candidate → auto-linked (`match_status = matched`), 0 candidates → auto-created (`match_status = auto_created`), 2+ candidates → left held (`match_status = ambiguous`); verify `ambiguousAutoResolved` count and `ambiguousRemaining` array in returned `ReconciliationResult`
- [x] T006 [P] [US1] Add `/reconcile` command handler tests in `backend/tests/handlers/discord.test.ts` — verify immediate `{ type: 5 }` response, summary message content for zero-held case (`🔄 比對完成 — 無待確認發票`) and multi-resolution case, and that `sendChannelMessage` is called once per remaining ambiguous invoice

### Implementation for User Story 1

- [x] T007 [US1] Implement Loop 2 (ambiguous invoice processing) appended after the existing forex loop inside `runReconciliationPass` in `backend/src/services/invoice-matcher.ts` — for each ambiguous invoice: re-query `findMatchingExpenseTransaction`; if 1 candidate → `resolveHeldInvoice` + `enrichTransaction` + increment `ambiguousAutoResolved`; if 0 candidates → `insertTransaction` (cash, Gemini tags) + `resolveHeldInvoice` + `enrichTransaction` + increment `ambiguousAutoResolved`; if 2+ → push to `ambiguousRemaining`
- [x] T008 [P] [US1] Add `formatReconcileSummary(result: ReconciliationResult): string` and `formatAmbiguousPrompt(invoice: Invoice, candidates: Transaction[]): DiscordMessage` helpers in `backend/src/handlers/discord.ts` — summary format per `contracts/discord-reconcile.md` §1; prompt format per §2 (candidate buttons capped at 5 most-recent, custom_id `reconcile_link:{invoiceId}:{transactionId}`, skip button `reconcile_skip:{invoiceId}`)
- [x] T009 [US1] Add `handleReconcileCommand(interaction, supabase, env, ctx)` in `backend/src/handlers/discord.ts` — return `{ type: 5 }` immediately; inside `ctx.waitUntil`: call `runReconciliationPass`, `patchInteractionMessage` with `formatReconcileSummary(result)`, then for each invoice in `result.ambiguousRemaining` call `findMatchingExpenseTransaction` and `sendChannelMessage` with `formatAmbiguousPrompt`; wrap in try/catch patching `❌ 比對失敗，請稍後再試。` on error
- [x] T010 [US1] Wire `handleReconcileCommand` into the `name === 'reconcile'` branch of the command dispatch in `backend/src/handlers/discord.ts`

**Checkpoint**: User Story 1 fully functional — `/reconcile` resolves forex and 1-candidate ambiguous invoices, posts summary, and sends sequential prompts for remaining ambiguous ones.

---

## Phase 4: User Story 2 — Explicit Ambiguous Resolution via Buttons (Priority: P2)

**Goal**: Users can click candidate buttons on the sequential prompt to explicitly link an ambiguous invoice, or skip it. Collision guard rejects links to already-matched transactions and refreshes candidates.

**Independent Test**: With an `ambiguous` invoice in the database, run `/reconcile` to trigger the sequential prompt. Click a candidate button. Verify the invoice is linked (`match_status = matched`), the transaction has `is_matched = true` and invoice fields populated, and the bot advances to the next ambiguous invoice (or ends the session).

### Tests for User Story 2

- [x] T011 [P] [US2] Add `reconcile_link` interaction tests in `backend/tests/handlers/discord.test.ts` — success path (`type: 7` with ✅ content + next prompt sent), collision path (`type: 7` with ⚠️ content + refreshed candidate buttons excluding conflicting tx), no-candidates-remaining path (auto-create + `type: 7` with ⚠️ notice)
- [x] T012 [P] [US2] Add `reconcile_skip` interaction tests in `backend/tests/handlers/discord.test.ts` — verify `type: 7` skip confirmation, next ambiguous prompt sent if remaining, end-of-session message if none remain

### Implementation for User Story 2

- [x] T013 [P] [US2] Add `handleReconcileLink(interaction, supabase, env)` in `backend/src/handlers/discord.ts` — parse `{invoiceId}:{transactionId}` from `custom_id`; verify `transactions.matched_invoice_id IS NULL` (collision guard); on success: `resolveHeldInvoice` + `enrichTransaction` → `type: 7` success + `sendChannelMessage` with next prompt; on collision: re-query fresh candidates (excluding matched tx), return `type: 7` refreshed buttons; if zero fresh candidates: auto-create + return `type: 7` auto-create notice + next prompt; on DB error: `type: 4` with `❌ 連結失敗，請稍後再試。`
- [x] T014 [P] [US2] Add `handleReconcileSkip(interaction, supabase, env)` in `backend/src/handlers/discord.ts` — parse `{invoiceId}` from `custom_id`; return `type: 7` skip confirmation; call `sendChannelMessage` with next ambiguous prompt if any remain (re-query `findAllAmbiguousInvoices` filtered to still-held); if none remain, append `（無更多待確認發票）` to the skip message per contract §4
- [x] T015 [US2] Wire `reconcile_link:` and `reconcile_skip:` `custom_id` prefixes into `handleComponentInteraction` dispatch in `backend/src/handlers/discord.ts` — consistent with existing `fee_link:` and `amend_select:` patterns

**Checkpoint**: User Stories 1 and 2 complete — full `/reconcile` flow including button-driven sequential resolution.

---

## Phase 5: User Story 3 — View Held Invoices (Priority: P3)

**Covered by Phase 3 (US1) — no additional tasks.** Per research Decision 1, the idempotent `/reconcile` pass output serves as the held invoice list: running the command when no data has changed takes milliseconds (DB reads only, no Gemini calls) and the summary groups results by status (`held_forex` remaining vs. `ambiguous` remaining). The sequential prompts sent for each remaining ambiguous invoice provide the per-invoice detail required by the acceptance criteria.

---

## Phase 6: Polish & Validation

- [x] T016 [P] Run `npm test` in `backend/` — all existing tests must pass; new tests from T005, T006, T011, T012 must pass
- [ ] T017 Follow `quickstart.md` verification scenarios end-to-end: register commands, deploy worker, run US1 happy path (corrected forex invoice resolves), run US2 happy path (ambiguous invoice button selection), run edge case (no held invoices → `🔄 比對完成 — 無待確認發票`), run idempotency check (two `/reconcile` runs produce identical output)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — T002 and T003 can run in parallel; T004 depends on T003
- **Phase 3 (US1)**: Depends on Phase 2 completion; T005/T006 (tests) and T008 can run in parallel with T007; T009 depends on T007 + T008; T010 depends on T009
- **Phase 4 (US2)**: Depends on Phase 3 completion; T011/T012 (tests) and T013/T014 can run in parallel; T015 depends on T013 + T014
- **Phase 6 (Polish)**: Depends on Phase 4 completion

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 2 (Foundational) only
- **US2 (P2)**: Depends on US1 completion (button handlers call helpers defined in US1)
- **US3 (P3)**: No tasks — covered by US1

### Parallel Opportunities

```bash
# Phase 2 — run in parallel:
T002: Add findAllAmbiguousInvoices to backend/src/db/queries.ts
T003: Define ReconciliationResult interface in backend/src/services/invoice-matcher.ts

# Phase 3 — run in parallel before implementation:
T005: Write invoice-matcher ambiguous loop tests
T006: Write /reconcile handler tests
T008: Write formatReconcileSummary + formatAmbiguousPrompt helpers  # different file to T007

# Phase 3 — then sequentially:
T007: Implement Loop 2 in runReconciliationPass  # depends on T003/T004
T009: Implement handleReconcileCommand           # depends on T007 + T008
T010: Wire into dispatch                         # depends on T009

# Phase 4 — run in parallel before implementation:
T011: Write reconcile_link tests
T012: Write reconcile_skip tests
T013: Implement handleReconcileLink              # can parallel T014
T014: Implement handleReconcileSkip             # can parallel T013
T015: Wire into handleComponentInteraction       # depends on T013 + T014
```

---

## Implementation Strategy

### MVP (User Story 1 Only — 10 tasks)

1. Complete Phase 1: T001
2. Complete Phase 2: T002 → T003 → T004
3. Complete Phase 3: T005/T006/T008 (parallel) → T007 → T009 → T010
4. **STOP and VALIDATE**: Register command, deploy, test `/reconcile` resolves a forex invoice
5. Ship MVP

### Full Delivery (All Stories)

1. MVP above
2. Phase 4: T011/T012/T013/T014 (parallel) → T015
3. Phase 6: T016/T017

---

## Notes

- No schema migrations. No new npm dependencies. No new source directories.
- All tasks target files within `backend/src/` or `backend/tests/` — consistent with existing project structure.
- `[P]` marks tasks touching different files with no blocking dependency — safe to run concurrently.
- The `handleReconcileLink` next-prompt logic must re-query `findAllAmbiguousInvoices` filtered to still-held (`match_status = 'ambiguous'`) rather than relying on the original `ambiguousRemaining` list (it may have changed since the pass ran).
