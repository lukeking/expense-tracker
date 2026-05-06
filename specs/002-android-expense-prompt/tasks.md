# Tasks: Android Expense Prompt

**Input**: Design documents from `specs/002-android-expense-prompt/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/android-prompt-api.md ✓, quickstart.md ✓

**Organization**: Tasks grouped by user story. US1 (plain expense) is independently shippable before US2 (fee/refund candidate list).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: Which user story this task belongs to (US1 = Manual Expense Entry, US2 = Fee/Refund)

---

## Phase 1: Setup (Shared Foundation)

**Purpose**: Room entity and type additions that both user stories depend on. Must complete before any story work.

- [ ] T001 Create `PendingManualInput` Room entity in `android/app/src/main/java/com/expenses/db/PendingManualInput.kt` — fields: id (autoincrement), text, parentTransactionId?, createdAt (epoch ms), retryCount
- [ ] T002 [P] Create `PendingManualInputDao` in `android/app/src/main/java/com/expenses/db/PendingManualInputDao.kt` — methods: insert, getAll (ordered by createdAt ASC), delete(id), incrementRetry(id)
- [ ] T003 Update `LocalDatabase` in `android/app/src/main/java/com/expenses/db/LocalDatabase.kt` — add `PendingManualInput::class` to @Database entities list, bump version 1→2, add Migration(1,2) that creates `pending_manual_inputs` table
- [ ] T004 [P] Add `InputResponse`, `BudgetSummary`, and `CandidateTransaction` TypeScript types to `backend/src/types.ts` — see data-model.md for field definitions

**Checkpoint**: Foundation ready — Room entity exists, DAO wired, DB migration defined, backend types in place. Both US1 and US2 can now proceed.

---

## Phase 2: Foundational (Blocking Prerequisites)

No additional foundational phase needed. Phase 1 covers all shared prerequisites.

---

## Phase 3: User Story 1 — Manual Expense Entry (Priority: P1) 🎯 MVP

**Goal**: User types freeform expense text in Android, it is stored via `POST /android/input`, with offline queuing via Room + WorkManager. Budget summary shown on success.

**Independent Test**: Submit `250 星巴克 拿鐵` while online → NT$250 expense appears in Supabase with budget summary displayed. Submit `150 便利商店` while offline → reappears in Supabase within 30 seconds of reconnecting. (Quickstart scenarios 1–4)

### Implementation for User Story 1

- [ ] T005 [US1] Implement `POST /android/input` route in `backend/src/handlers/android.ts` — parse `text` + optional `parent_transaction_id` from JSON body; detect `fee `/`refund ` prefix (case-insensitive) to set `transaction_type`; call existing Gemini parse service; insert into Supabase `transactions`; fetch budget summary via existing `budget.ts`; return `InputResponse` with `budget_summary`; return 422 on parse failure; return 409 on dedup (same amount + text within 3 minutes)
- [ ] T006 [P] [US1] Create `activity_prompt.xml` layout in `android/app/src/main/res/layout/activity_prompt.xml` — vertical LinearLayout with: multiline EditText (hint: "250 星巴克 拿鐵"), submit Button, TextView for confirmation/error message, RecyclerView (visibility GONE by default, for US2 candidate list)
- [ ] T007 [P] [US1] Add `postInput(text: String, parentTransactionId: String?)` suspend function to `ApiClient` in `android/app/src/main/java/com/expenses/network/ApiClient.kt` — POST to `/android/input`, return `InputResponse`, throws `HttpException` on 4xx/5xx
- [ ] T008 [US1] Create `ManualInputSyncWorker` in `android/app/src/main/java/com/expenses/worker/ManualInputSyncWorker.kt` — WorkManager `CoroutineWorker`; in `doWork()`: call `pendingManualInputDao.getAll()`; for each entry call `apiClient.postInput(text, parentTransactionId)`; on success delete from DB; on 409 delete from DB (permanent failure, log); on `retryCount >= 5` delete from DB; on transient error call `incrementRetry` and return `Result.retry()`; use exponential backoff via `BackoffPolicy.EXPONENTIAL`
- [ ] T009 [US1] Create `PromptActivity` in `android/app/src/main/java/com/expenses/ui/PromptActivity.kt` — on submit: validate non-empty text; insert `PendingManualInput(text=input)` into Room; enqueue `ManualInputSyncWorker` (replace existing if already queued); if online show "Submitting…"; observe WorkManager output for result; on success show confirmation message + clear EditText + re-focus; on 422 (parse error) show error message and preserve input text; on offline show "Saved — will sync when connected" + clear input
- [ ] T010 [US1] Register `PromptActivity` in `android/app/src/main/AndroidManifest.xml` and add a launch entry point in the existing main activity (e.g., FloatingActionButton or menu item navigating to `PromptActivity`)
- [ ] T011 [US1] Write `ManualInputSyncWorkerTest` in `android/app/src/test/java/com/expenses/worker/ManualInputSyncWorkerTest.kt` — test cases (MockK): (a) successful sync deletes DB entry; (b) 409 response discards without retry; (c) network error increments retryCount and returns retry; (d) retryCount=5 deletes entry instead of retrying; (e) offline insert persists to DB without network call

**Checkpoint**: US1 complete. Plain expense entry works end-to-end, offline queuing functional. Submit `250 星巴克 拿鐵`, verify Supabase row + budget summary shown in-app.

---

## Phase 4: User Story 2 — Fee/Refund with Candidate List (Priority: P2)

**Goal**: User types `fee [amount] [desc]` or `refund [amount] [desc]`. App detects prefix, fetches candidate transactions via `GET /android/transactions/recent`, shows scrollable tap-select list with "None of these" escape hatch. Selected candidate's UUID is sent as `parent_transaction_id` to `POST /android/input`.

**Independent Test**: Create NT$1,200 "Airbnb" expense, then submit `fee 180 Airbnb` → candidate list shows Airbnb row → tap it → NT$180 fee record created in Supabase linked to Airbnb UUID. Submit `fee 47 某商店` with no matches → "None of these" → NT$47 fee with `parent_transaction_id=NULL`. (Quickstart scenarios 5–8)

### Implementation for User Story 2

- [ ] T012 [US2] Implement `GET /android/transactions/recent` route in `backend/src/handlers/android.ts` — query params: `q` (optional substring filter), `limit` (default 20, max 50); query Supabase `transactions` where `transaction_type='expense'`; if `q` provided, filter where item names or note contains `q` (case-insensitive); order by `transaction_at DESC`; return `{ candidates: CandidateTransaction[] }` where description = joined item names or note
- [ ] T013 [P] [US2] Create `item_candidate.xml` layout in `android/app/src/main/res/layout/item_candidate.xml` — horizontal row with: date TextView (formatted "MM/dd"), description TextView, amount TextView ("NT$xxx"); tappable via `android:clickable="true"` and `android:focusable="true"`
- [ ] T014 [P] [US2] Create `CandidateAdapter` RecyclerView adapter in `android/app/src/main/java/com/expenses/ui/CandidateAdapter.kt` — accepts `List<CandidateTransaction>` + `onSelect: (String?) -> Unit` callback; renders each candidate using `item_candidate.xml`; appends a hard-coded "None of these / record without link" footer item that calls `onSelect(null)`
- [ ] T015 [P] [US2] Add `getRecentTransactions(q: String?, limit: Int = 20)` suspend function to `ApiClient` in `android/app/src/main/java/com/expenses/network/ApiClient.kt` — GET `/android/transactions/recent` with query params; return `List<CandidateTransaction>`
- [ ] T016 [US2] Extend `PromptActivity` in `android/app/src/main/java/com/expenses/ui/PromptActivity.kt` — on submit: if input starts with `fee ` or `refund ` (case-insensitive, after trim): extract description part after amount token; call `apiClient.getRecentTransactions(q=description)`; set RecyclerView adapter with returned candidates (VISIBLE); on candidate tap (or "None of these") set `resolvedParentId`; insert `PendingManualInput(text=input, parentTransactionId=resolvedParentId)` and proceed as US1; if no `fee`/`refund` prefix skip candidate step entirely
- [ ] T017 [US2] Write `PromptViewModelTest` (or direct Activity unit test) in `android/app/src/test/java/com/expenses/ui/PromptViewModelTest.kt` — test cases (MockK): (a) plain expense skips candidate fetch; (b) `fee 47 Airbnb` triggers `getRecentTransactions(q="Airbnb")`; (c) candidate tap sets parentTransactionId before insert; (d) "None of these" tap sets parentTransactionId=null; (e) `fee 47` with no description triggers `getRecentTransactions(q=null)`

**Checkpoint**: US2 complete. Fee and refund commands work with candidate list selection and "None of these" escape hatch. Both US1 and US2 independently functional.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Validation, deployment, and regression checks.

- [ ] T018 [P] Run existing Android unit tests and confirm no regressions: `./gradlew test` in `android/` — `NotificationParserTest` and `TransactionSyncWorkerTest` must remain green
- [ ] T019 [P] Deploy updated CF Worker with new routes by running `wrangler deploy` from `backend/` — confirm `/android/input` and `/android/transactions/recent` respond correctly via quickstart.md curl commands
- [ ] T020 Validate all 8 quickstart.md integration scenarios manually on device or emulator — mark each scenario in `specs/002-android-expense-prompt/quickstart.md` Definition of Done checklist

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately; T001/T002/T003/T004 can overlap (T002 and T004 are [P])
- **US1 (Phase 3)**: Depends on Phase 1 completion — T005 through T011 proceed sequentially with [P] exceptions
- **US2 (Phase 4)**: Depends on Phase 1 completion AND T009 (PromptActivity base) — T012/T013/T014/T015 are [P] within US2
- **Polish (Phase 5)**: Depends on all story phases complete

### Within US1 (sequential constraints)

- T007 (ApiClient) and T006 (layout) can run in parallel
- T008 (SyncWorker) depends on T001-T003 (Room entity/DAO/DB)
- T009 (PromptActivity) depends on T006 (layout), T007 (ApiClient), T008 (SyncWorker)
- T010 (manifest) depends on T009
- T011 (SyncWorker tests) can be written alongside T008

### Within US2 (sequential constraints)

- T012 (backend route), T013 (item layout), T014 (adapter), T015 (ApiClient) are fully parallel
- T016 (extend PromptActivity) depends on T013, T014, T015, and T009
- T017 (tests) can be written alongside T016

---

## Parallel Execution Examples

### Phase 1 parallel start

```
Parallel:
  Task T001: PendingManualInput.kt entity
  Task T002: PendingManualInputDao.kt
  Task T004: types.ts additions
Then sequential:
  Task T003: LocalDatabase migration (depends on T001+T002)
```

### US1 parallel opportunities

```
Parallel (after Phase 1 complete):
  Task T005: POST /android/input backend route
  Task T006: activity_prompt.xml layout
  Task T007: ApiClient.postInput()
Then sequential:
  Task T008: ManualInputSyncWorker (depends on T001-T003)
  Task T009: PromptActivity (depends on T006, T007, T008)
  Task T010: AndroidManifest (depends on T009)
  Task T011: ManualInputSyncWorkerTest (alongside T008)
```

### US2 parallel opportunities

```
Parallel (after T009 complete):
  Task T012: GET /android/transactions/recent backend
  Task T013: item_candidate.xml layout
  Task T014: CandidateAdapter.kt
  Task T015: ApiClient.getRecentTransactions()
Then sequential:
  Task T016: Extend PromptActivity (depends on T013, T014, T015)
  Task T017: PromptViewModelTest (alongside T016)
```

---

## Implementation Strategy

### MVP (US1 Only — 11 tasks)

1. Complete Phase 1: Setup (T001–T004)
2. Complete Phase 3: US1 (T005–T011)
3. **Validate**: Submit expense online + offline. Confirm Supabase row + budget summary.
4. Deploy backend with `wrangler deploy`
5. Ship — US2 can follow as an independent increment

### Incremental Delivery

1. Setup + US1 → plain expense entry works end-to-end → **MVP shipped**
2. Add US2 → fee/refund with candidate list → enhanced experience
3. Polish phase → regression checks, full quickstart validation

---

## Notes

- [P] tasks operate on different files with no dependency on in-progress siblings
- The `fee`/`refund` prefix detection in `PromptActivity` is UI-only (not business logic) — the server is the authoritative parser per research Decision 1
- `ManualInputSyncWorker` handles 409 as permanent failure (not a retryable error) because 409 here means "cannot parse" not "already exists"
- RecyclerView for candidate list is present in `activity_prompt.xml` from T006 but stays `GONE` until US2 (T016) shows it — avoids layout changes when adding US2
- No new Supabase migrations needed — `parent_transaction_id` and `transaction_type` columns already exist from feature 001
