---
description: "Task list for Expense Tracker implementation"
---

# Tasks: Expense Tracker (Discord Bot + Android)

**Input**: Design documents from `specs/001-expense-tracker/`
**Prerequisites**: plan.md ✅, data-model.md ✅, research.md ✅, quickstart.md ✅, contracts/ ✅
**Spec source**: proposal.md (no spec.md — user stories derived from proposal + plan)

**Tests**: Included — mandated by the project constitution (Quality Standards section).

**Organization**: Tasks grouped by user story for independent implementation and delivery.

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel (different files, no shared dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the project skeleton so both backend and Android can be developed in parallel.

- [X] T001 Create top-level directory structure: `backend/`, `android/`, `backend/supabase/`, `backend/scripts/` per plan.md
- [X] T002 [P] Initialize Cloudflare Workers TypeScript project in `backend/` — `wrangler init`, configure `wrangler.toml` with Cron Trigger (`0 2 * * *`), install Hono, `@supabase/supabase-js`, `@noble/ed25519`, `vitest`, `@cloudflare/vitest-pool-workers`
- [X] T003 [P] Initialize Android Gradle project in `android/` — Kotlin DSL, `compileSdk 34`, add Room, WorkManager, Retrofit, OkHttp, Kotlin Coroutines, MockK, JUnit 4 dependencies in `android/app/build.gradle.kts`
- [X] T004 [P] Configure linting and formatting — ESLint + Prettier for `backend/`, ktlint for `android/`; add `backend/vitest.config.ts` with `@cloudflare/vitest-pool-workers` pool configuration

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before any user story can be implemented.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T005 Create Supabase schema migration in `backend/supabase/schema.sql` — `transactions`, `receipts`, `budget_settings`, `pending_matches` tables with all indexes per data-model.md
- [X] T006 [P] Implement Supabase client singleton in `backend/src/db/client.ts` — typed client using `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` env bindings
- [X] T007 [P] Implement shared TypeScript types in `backend/src/types.ts` — `Transaction`, `Receipt`, `BudgetSettings`, `PaymentMethod`, `TransactionItem`, `ReceiptItem` per data-model.md
- [X] T008 Implement Discord ed25519 signature verification middleware in `backend/src/middleware/discord-verify.ts` — verify `X-Signature-Ed25519` + `X-Signature-Timestamp` using `@noble/ed25519` and `DISCORD_PUBLIC_KEY` binding; return `401` on failure
- [X] T009 [P] Implement Android API key verification middleware in `backend/src/middleware/android-auth.ts` — validate `Authorization: Bearer <key>` against `ANDROID_API_KEY` binding; return `401` on failure
- [X] T010 Implement typed DB query functions in `backend/src/db/queries.ts` — `insertTransaction`, `getMonthlySpend`, `getBudgetSettings`, `updateBudgetSettings`, `upsertReceipts`, `findMatchCandidates`, `matchTransaction`, `getUnmatchedTransactions`, `insertPendingMatch`, `resolvePendingMatch`
- [X] T011 Implement Hono router entry point in `backend/src/index.ts` — route stubs for `POST /discord/interactions`, `POST /api/notification`, `GET /api/health`, and `scheduled` export for Cron Trigger handler; wire in middlewares
- [X] T012 [P] Create Room database and entity in `android/app/src/main/java/com/expenses/db/` — `PendingTransaction.kt` entity (id, amount, bankName, paymentMethod, notifiedAt, rawText, retryCount), `LocalDatabase.kt`, `PendingTransactionDao.kt`
- [X] T013 [P] Configure `wrangler.toml` — declare all required secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DISCORD_PUBLIC_KEY`, `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN`, `GEMINI_API_KEY`, `ANDROID_API_KEY`, `MOF_CARRIER_ID`, `MOF_VERIFICATION_CODE`, `MOF_API_KEY`, `DISCORD_CHANNEL_ID`), `compatibility_date`, `compatibility_flags = ["nodejs_compat"]`

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 — Manual Discord Expense Entry (Priority: P1) 🎯 MVP

**Goal**: User types `/expense 150 燙青菜 牛肉麵` in Discord, gets a formatted confirmation with budget status. User can also check `/summary` and update `/budget`.

**Independent Test**: Deploy to `wrangler dev`, use a Discord test server, run all three slash commands, verify confirmation messages and Supabase row creation.

### Implementation for User Story 1

- [X] T014 [P] [US1] Implement Gemini NLP parsing service in `backend/src/services/gemini.ts` — raw `fetch` to Gemini `generateContent` endpoint, JSON-mode prompt, parse `{ amount, items[], tags[] }` from free-text descriptions; use `gemini-2.0-flash` model
- [X] T015 [P] [US1] Implement monthly budget computation service in `backend/src/services/budget.ts` — `getMonthlyTotal(supabase, year, month)`, `getBudgetProgress(supabase)` returning current spend + budget + percentage
- [X] T016 [US1] Implement Discord slash command handler in `backend/src/handlers/discord.ts` — handle PING (type 1), `/expense` command (type 2): return deferred `type: 5`, use `ctx.waitUntil()` to call Gemini, write to `transactions`, compute budget progress, PATCH Discord follow-up message
- [X] T017 [US1] Implement `/budget` command handler in `backend/src/handlers/discord.ts` — validate amount > 0, update `budget_settings`, return immediate `type: 4` confirmation
- [X] T018 [US1] Implement `/summary [month]` command handler in `backend/src/handlers/discord.ts` — return deferred `type: 5`, aggregate monthly spend by tags, format summary message, PATCH follow-up
- [X] T019 [US1] Implement Discord message PATCH helper in `backend/src/services/discord-notify.ts` — `patchInteractionMessage(applicationId, token, content)` and `sendChannelMessage(channelId, content)` using `DISCORD_BOT_TOKEN`
- [X] T020 [P] [US1] Create Discord slash command registration script in `backend/scripts/register-commands.ts` — registers `/expense`, `/budget`, `/summary` with correct option schemas via Discord REST API; run with `npx tsx`
- [X] T021 [US1] Wire Discord handler into router in `backend/src/index.ts` — `app.post('/discord/interactions', discordVerify, discordHandler)`
- [ ] T022 [US1] Deploy backend and verify US1 end-to-end — run `wrangler secret put` for all secrets, `wrangler deploy`, register slash commands, test all three commands in Discord, verify `transactions` rows in Supabase

**Checkpoint**: User Story 1 fully functional. Manual expense tracking via Discord works independently.

---

## Phase 4: User Story 2 — Android Notification Auto-Capture (Priority: P2)

**Goal**: Android app intercepts bank push notifications, parses amount and bank name, queues offline, syncs to CF Worker which stores the transaction and sends a proactive Discord notification.

**Independent Test**: Install Android APK, grant NotificationListenerService permission, trigger a test notification, verify transaction appears in Supabase and Discord shows the proactive message — all without any Discord slash command input.

### Implementation for User Story 2

- [X] T023 [P] [US2] Implement notification parser in `android/app/src/main/java/com/expenses/parser/NotificationParser.kt` — regex patterns for major TW banks (台新、國泰、玉山、中信、富邦) and mobile pay (LINE Pay、街口); extract `amount`, `bank_name`, `payment_method` from raw notification title + text; return `null` for non-payment notifications
- [X] T024 [P] [US2] Implement Android notification ingestion endpoint in `backend/src/handlers/android.ts` — `POST /api/notification`: validate fields, check duplicate (same amount+bank+method within 5 min per `contracts/android-api.md`), insert `transactions` row with `discord_message_id=null`, call `sendChannelMessage` for proactive Discord notification, return `201` with transaction ID
- [X] T025 [P] [US2] Implement health check endpoint in `backend/src/handlers/android.ts` — `GET /api/health`: return `{ status: "ok", timestamp }` with `200`
- [X] T026 [US2] Implement proactive Discord channel notification in `backend/src/services/discord-notify.ts` — `sendTransactionNotification(transaction, budgetProgress)`: format and POST to `DISCORD_CHANNEL_ID`, store returned Discord message ID
- [X] T027 [US2] Update `insertTransaction` in `backend/src/db/queries.ts` to store `discord_message_id` returned from Discord; add `updateDiscordMessageId(transactionId, messageId)` helper
- [X] T028 [P] [US2] Implement `ApiClient` in `android/app/src/main/java/com/expenses/network/ApiClient.kt` — Retrofit interface with `postNotification(body)` and `getHealth()` endpoints; `Authorization: Bearer` header from `secrets.xml`
- [X] T029 [US2] Implement `TransactionSyncWorker` in `android/app/src/main/java/com/expenses/worker/TransactionSyncWorker.kt` — `CoroutineWorker`: read oldest pending `PendingTransaction` from Room, POST to `/api/notification`, on 201 delete from Room, on 409 delete from Room (duplicate), on 5xx/network error return `Result.retry()`; use exponential backoff (`BackoffPolicy.EXPONENTIAL`, 30s initial, max 10 attempts)
- [X] T030 [US2] Implement `NotificationListenerService` in `android/app/src/main/java/com/expenses/service/ExpenseNotificationListenerService.kt` — parse notification with `NotificationParser`, insert to Room DB, enqueue `OneTimeWorkRequest<TransactionSyncWorker>` with network constraint
- [X] T031 [US2] Wire Android endpoints into router in `backend/src/index.ts` — `app.post('/api/notification', androidAuth, androidHandler)` and `app.get('/api/health', healthHandler)`
- [ ] T032 [US2] Build and install Android APK; grant NotificationListenerService permission; verify end-to-end notification → Room → WorkManager → CF Worker → Supabase → Discord message flow

**Checkpoint**: User Story 2 fully functional. Auto-capture from bank notifications works independently.

---

## Phase 5: User Story 3 — Receipt Matching with 財政部 API (Priority: P3)

**Goal**: Daily Cron Trigger fetches invoices from 財政部, auto-matches them to unmatched transactions by amount+date, updates Discord messages with receipt detail, and prompts user for manual confirmation on ambiguous cases.

**Independent Test**: Trigger `/__scheduled` endpoint locally, verify receipts table populated, unambiguous transaction gets `is_matched=true` and its Discord message edited with seller name + items, ambiguous case shows Discord button prompt.

### Implementation for User Story 3

- [X] T033 [P] [US3] Implement MOF API client in `backend/src/handlers/mof-sync.ts` — `fetchMofInvoices(env, date)`: build query params per `contracts/mof-api.md`, fetch from `einvoice.nat.gov.tw`, parse ROC calendar dates (add 1911), handle error codes (401 → Discord alert, 404 → no-op, 429/5xx → log and exit)
- [X] T034 [P] [US3] Implement `upsertReceipts` in `backend/src/db/queries.ts` — `INSERT ... ON CONFLICT (invoice_number) DO NOTHING` to idempotently store fetched invoices with all fields from data-model.md
- [X] T035 [US3] Implement matching algorithm service in `backend/src/services/matcher.ts` — `runMatchingAlgorithm(env)`: fetch unmatched transactions, for each find receipts with `total_amount = amount` and `invoice_date` within ±48h of `transaction_at`; single match → auto-match + update Discord; multiple matches → create `pending_matches` row + send Discord button message; zero matches → no-op
- [X] T036 [US3] Implement auto-match Discord message edit in `backend/src/services/discord-notify.ts` — `patchTransactionMatchedMessage(transaction, receipt)`: format seller name, items list, auto-tags; PATCH the stored `discord_message_id`
- [X] T037 [US3] Implement ambiguous match Discord alert in `backend/src/services/discord-notify.ts` — `sendAmbiguousMatchAlert(transaction, candidateReceipts)`: POST message with action buttons (`custom_id: "confirm_match:{txId}:{receiptId}"`) for each candidate receipt
- [X] T038 [US3] Implement Discord button component handler in `backend/src/handlers/discord.ts` — handle `type: 3` (MESSAGE_COMPONENT): parse `custom_id = "confirm_match:{txId}:{receiptId}"`, call `matchTransaction`, `resolvePendingMatch`, update Discord original message, return `type: 4` confirmation
- [X] T039 [US3] Implement Cron Trigger scheduled handler in `backend/src/index.ts` — export `scheduled(event, env, ctx)`: call `handleMofSync(env)` inside `ctx.waitUntil()`; `handleMofSync` calls `fetchMofInvoices` → `upsertReceipts` → `runMatchingAlgorithm`
- [ ] T040 [US3] Test Cron Trigger locally — `wrangler dev --test-scheduled`, send `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`, verify receipts fetched, matching logic executes, Discord messages updated

**Checkpoint**: User Story 3 fully functional. Full automation pipeline (Android → CF Worker → MOF sync → Discord) works end-to-end.

---

## Phase N: Tests & Polish

**Purpose**: Satisfy constitution Quality Standards; harden security; cross-cutting improvements.

### Unit Tests (Constitution-Mandated)

- [X] T041 [P] Write Vitest unit tests for Discord ed25519 verification in `backend/tests/handlers/discord.test.ts` — valid signature passes, invalid signature returns 401, PING returns type 1
- [X] T042 [P] Write Vitest unit tests for `/expense` command handler in `backend/tests/handlers/discord.test.ts` — deferred response returned, Gemini called with correct prompt, transaction inserted, budget progress computed
- [X] T043 [P] Write Vitest unit tests for Gemini parsing service in `backend/tests/services/gemini.test.ts` — parses amount+items from Chinese text, handles edge cases (no items, large amounts, special chars)
- [X] T044 [P] Write Vitest unit tests for matching algorithm in `backend/tests/services/matcher.test.ts` — single candidate auto-matched, multiple candidates create pending_match, zero candidates are no-ops
- [X] T045 [P] Write Vitest unit tests for Android ingestion endpoint in `backend/tests/handlers/android.test.ts` — valid payload creates transaction, duplicate within 5 min returns 409, missing field returns 400, bad API key returns 401
- [X] T046 [P] Write Vitest unit tests for MOF sync handler in `backend/tests/handlers/mof-sync.test.ts` — ROC date conversion, 401 response triggers Discord alert, 404 response is no-op
- [X] T047 [P] Write JUnit/MockK unit tests for `NotificationParser` in `android/app/src/test/java/com/expenses/parser/NotificationParserTest.kt` — correctly parses 台新/國泰/LINE Pay patterns, returns null for non-payment notifications
- [X] T048 [P] Write JUnit/MockK unit tests for `TransactionSyncWorker` in `android/app/src/test/java/com/expenses/worker/TransactionSyncWorkerTest.kt` — 201 response deletes from Room, 409 deletes without retry, 5xx returns `Result.retry()`

### Security & Polish

- [X] T049 Security audit — verify no secrets in source code or `wrangler.toml`; confirm all credentials are `wrangler secret put`; verify Android `secrets.xml` is in `.gitignore`
- [X] T050 [P] Update `backend/supabase/schema.sql` with any schema adjustments discovered during implementation; re-run migration on Supabase
- [X] T051 [P] Performance check — verify Discord handlers respond with deferred `type: 5` within 3s; verify no synchronous Supabase calls block the response path
- [ ] T052 Run quickstart.md validation — follow the guide from scratch on a clean environment; update any stale steps

---

## Phase P: Payment Model Update (Clarification 2026-05-06)

**Purpose**: Apply the expanded payment model to all existing source files. All Phase 1–N tasks are already complete; this phase patches the code to match the new data model agreed in the clarification session.

**Changes covered**:
- `payment_method`: 5 values (`credit_card` | `prepaid_wallet` | `easy_card` | `bank_account` | `cash`), removing `mobile_pay`
- New `wallet` column (`'line_pay'` | `'google_pay'` | null) for `credit_card` / `prepaid_wallet` rows
- Dedup logic: upsert on `amount + 3-minute window` (replaces 409-on-duplicate)
- Android parser: `wallet` detection + ignore list (EasyCard auto top-up, ATM withdrawal)
- Android worker: treat HTTP 200 (merge) as success

### Backend — Types & DB

- [X] T053 Update `PaymentMethod` type and add `MobileWallet` type in `backend/src/types.ts` — `PaymentMethod = 'credit_card' | 'prepaid_wallet' | 'easy_card' | 'bank_account' | 'cash'`; `MobileWallet = 'line_pay' | 'google_pay'`; add `wallet: MobileWallet | null` field to `Transaction` interface
- [X] T054 [P] Rewrite `findDuplicateTransaction` in `backend/src/db/queries.ts` → rename to `findExistingTransaction`, query on `amount + created_at > NOW() - INTERVAL '3 minutes'` only (remove `payment_method` and `bank_name` conditions); add `mergeTransactionFields(id, fields)` helper that UPDATEs only null `bank_name` / `wallet` fields
- [X] T055 [P] Update `insertTransaction` signature in `backend/src/db/queries.ts` — add optional `wallet: MobileWallet | null` parameter; include in INSERT

### Backend — Handler

- [X] T056 Rewrite duplicate-handling logic in `backend/src/handlers/android.ts` — replace 409-on-duplicate with upsert: call `findExistingTransaction`; if found → call `mergeTransactionFields` and return `200 { transaction_id, discord_message_id, merged: true }`; if not found → insert and return `201`; update payload validation to accept all five `payment_method` values and optional `wallet` field

### Android — Parser

- [X] T057 Expand `NotificationParser.kt` in `android/app/src/main/java/com/expenses/parser/NotificationParser.kt` — add `shouldIgnore(title, text): Boolean` method returning `true` for EasyCard auto top-up (`自動加值`/`自動補值`) and ATM withdrawal (`提款`/`提現`/`ATM`); add `wallet: String?` field to `ParsedNotification`; detect LINE Pay (`LINE Pay`/`LinePay` in title → `wallet = "line_pay"`) and Google Pay (`Google Pay` → `wallet = "google_pay"`); call `shouldIgnore` first in `parse()` and return `null` if matched

### Android — Network & Worker

- [X] T058 [P] Add `wallet: String?` field to `NotificationRequest` data class in `android/app/src/main/java/com/expenses/network/ApiClient.kt`; populate from `ParsedNotification.wallet` in `ExpenseNotificationListenerService`
- [X] T059 [P] Update `TransactionSyncWorker.kt` in `android/app/src/main/java/com/expenses/worker/TransactionSyncWorker.kt` — treat HTTP `200` response as success (delete from Room, `Result.success()`), same as `201`; remove any `409` branch (server no longer returns 409 for same-window duplicates)

### Tests

- [X] T060 [P] Update `backend/tests/handlers/android.test.ts` — replace 409-duplicate test with upsert-merge test (second notification with same amount returns 200 with `merged: true`); add test for `easy_card` and `prepaid_wallet` payment methods; add test for invalid `wallet` value rejected when `payment_method` is `cash`
- [X] T061 [P] Update `android/app/src/test/java/com/expenses/parser/NotificationParserTest.kt` — add tests: EasyCard auto top-up notification returns `null` (shouldIgnore); ATM withdrawal notification returns `null`; LINE Pay title sets `wallet = "line_pay"`; Google Pay title sets `wallet = "google_pay"`; regular bank notification has `wallet = null`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — no dependency on US2/US3
- **US2 (Phase 4)**: Depends on Foundational — no dependency on US1/US3 (can run in parallel with US1)
- **US3 (Phase 5)**: Depends on Foundational + US2 (reuses `discord_message_id` stored by US2 handler)
- **Polish (Phase N)**: Depends on all desired user stories complete
- **Payment Model Update (Phase P)**: Depends on Phase N — patches existing code, no new user stories

### User Story Dependencies

- **US1 (P1)**: Independent after Foundational
- **US2 (P2)**: Independent after Foundational (can run in parallel with US1)
- **US3 (P3)**: Depends on US2 (needs `discord_message_id` stored by Android ingestion handler)

### Within Each User Story

- Models/types before services
- Services before handlers
- Handlers before router wiring
- Router wiring before end-to-end validation

### Parallel Opportunities

All tasks marked `[P]` can execute simultaneously within their phase.

Notable parallel opportunities:
- T002 (backend init) ∥ T003 (Android init) ∥ T004 (linting config)
- T005, T006, T007, T009, T012, T013 all parallelizable within Phase 2
- T014 (Gemini service) ∥ T015 (budget service) ∥ T020 (command registration) within US1
- T023 (Android parser) ∥ T024 (ingestion endpoint) ∥ T025 (health check) ∥ T028 (ApiClient) within US2
- T033 (MOF client) ∥ T034 (upsertReceipts) within US3
- All T041–T048 test tasks are fully parallelizable

---

## Parallel Execution Example: User Story 1

```bash
# Start simultaneously:
Task: "Implement Gemini NLP service in backend/src/services/gemini.ts"     # T014
Task: "Implement budget computation service in backend/src/services/budget.ts"  # T015
Task: "Create Discord command registration script in backend/scripts/"      # T020

# Then (after T014 + T015):
Task: "Implement /expense handler in backend/src/handlers/discord.ts"       # T016
Task: "Implement /budget handler in backend/src/handlers/discord.ts"        # T017
Task: "Implement /summary handler in backend/src/handlers/discord.ts"       # T018
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: `/expense`, `/budget`, `/summary` working in Discord; row in Supabase; budget tracking live
5. Deploy `wrangler deploy` — MVP is live

### Incremental Delivery

1. Setup + Foundational → skeleton ready
2. US1 → manual Discord tracking works → **MVP demo**
3. US2 → Android auto-capture works → **90% manual input eliminated**
4. US3 → receipt matching works → **full automation + receipt detail**
5. Polish → tests + security hardened → **production-ready**

### Parallel Team Strategy

Once Phase 2 (Foundational) is complete:
- **Developer A**: Phase 3 (US1 — Discord backend)
- **Developer B**: Phase 4 (US2 — Android app + ingestion endpoint)
- Both integrate after US2, then tackle US3 together

---

## Notes

- `[P]` = different files, no unsatisfied dependencies — safe to parallelize
- `[USn]` = maps task to a specific user story for traceability
- US3 depends on US2 (Discord message IDs from Android ingestion must exist to be PATCH-edited)
- Tests are mandated by the constitution Quality Standards section — not optional for this project
- Commit after each phase checkpoint using `/speckit-git-commit`
- Always use `ctx.waitUntil()` for any operation slower than ~100ms in Discord handlers
