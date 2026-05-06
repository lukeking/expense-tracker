# Implementation Plan: Android Expense Prompt

**Branch**: `001-expense-tracker` | **Date**: 2026-05-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/002-android-expense-prompt/spec.md`

## Summary

Add a freeform text prompt screen to the existing Android app that replicates Discord bot expense-entry functionality: manual expense, `fee [amount] [desc]`, and `refund [amount] [desc]` commands. The backend parses raw text via Gemini, stores the result in Supabase, and returns a budget summary. Offline inputs queue in a new `PendingManualInput` Room entity (separate from `PendingTransaction`) and sync via a new WorkManager worker. Two new backend routes extend the existing `android.ts` handler.

## Technical Context

**Language/Version**: Kotlin 1.9 (Android, API 26+); TypeScript (CF Workers runtime, ES2022)
**Primary Dependencies**:
  - Android: Room, WorkManager, OkHttp/Retrofit, Kotlin Coroutines, RecyclerView
  - Backend: Hono (routing), `@supabase/supabase-js` v2, Gemini API (raw HTTP), existing `budget.ts` service
**Storage**: Room (Android local queue); Supabase hosted PostgreSQL (server)
**Testing**: JUnit 4 + MockK (Android); Vitest + `@cloudflare/vitest-pool-workers` (backend)
**Target Platform**: Android 8.0+ (API 26+); Cloudflare Workers
**Project Type**: Extension of existing personal tool — new UI screen + two new backend routes
**Performance Goals**: End-to-end submit → confirmation < 10s on normal connection (SC-001); candidate list fetch < 2s
**Constraints**: Offline-first (Room + WorkManager mandatory); no Supabase direct access from Android; Android API key auth only
**Scale/Scope**: Same single-user, ~50–100 transactions/month

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [X] **I. Simplicity-First** — One new Activity, one new Room entity, two new backend routes. No new services, libraries, or components beyond what the spec requires. The candidate list uses a plain RecyclerView (no bottom sheet). `PendingManualInput` avoids sharing schema with `PendingTransaction` because the two queue structurally different data.
- [X] **II. Offline-First on Android** — Manual inputs are persisted to `PendingManualInput` (Room) before any network call. `ManualInputSyncWorker` (WorkManager, exponential backoff) handles all sync. `PromptActivity` enqueues the worker; it does not make direct network calls on the submit path. Duplicate detection via 3-minute window dedup at the server layer.
- [X] **III. Serverless Boundary Compliance** — Both new routes (`POST /android/input`, `GET /android/transactions/recent`) are synchronous for the query portion. The Gemini parse call + Supabase write inside `POST /android/input` MUST use the existing deferred pattern if they risk approaching 3s. No WebSockets or gateway connections introduced.
- [X] **IV. Automation Over Manual Input** — This feature is the manual fallback path, not a replacement for automation. It adds low-friction single-field input with no required metadata beyond the freeform text. No wizard, no pickers. The candidate list for fee/refund reduces user cognitive load (tap vs. recall).
- [X] **V. Security at System Boundaries** — Android authenticates via the existing `ANDROID_API_KEY` header. No Supabase key on the client. API key validated in the Worker middleware. All Supabase writes go through the CF Worker.

*Post-design re-check*: No violations introduced. Architecture is a straightforward extension of existing patterns.

## Project Structure

### Documentation (this feature)

```text
specs/002-android-expense-prompt/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output: PendingManualInput entity
├── quickstart.md        # Phase 1 output: integration test guide
├── contracts/
│   └── android-prompt-api.md   # POST /android/input + GET /android/transactions/recent
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code

```text
# Android (extend existing com.expenses package)
android/app/src/main/java/com/expenses/
├── db/
│   ├── PendingManualInput.kt          # NEW — Room entity for queued raw text inputs
│   ├── PendingManualInputDao.kt       # NEW — insert / getAll / delete / incrementRetry
│   └── LocalDatabase.kt              # MODIFY — add PendingManualInput to @Database entities
├── network/
│   └── ApiClient.kt                  # MODIFY — add postInput() + getRecentTransactions()
├── ui/
│   ├── PromptActivity.kt             # NEW — single-screen prompt UI
│   └── CandidateAdapter.kt           # NEW — RecyclerView adapter for fee/refund candidate list
├── worker/
│   └── ManualInputSyncWorker.kt      # NEW — WorkManager worker: dequeue → POST → mark done
└── (no changes to NotificationListenerService, TransactionSyncWorker, or parser)

android/app/src/main/res/layout/
├── activity_prompt.xml               # NEW — EditText + submit button + RecyclerView (GONE by default)
└── item_candidate.xml                # NEW — single candidate row (date + description + amount)

android/app/src/main/AndroidManifest.xml   # MODIFY — register PromptActivity

android/app/src/test/java/com/expenses/
├── worker/ManualInputSyncWorkerTest.kt    # NEW — offline queue, retry, dedup 409 handling
└── ui/PromptViewModelTest.kt             # NEW — command detection, candidate fetch trigger

# Backend (extend existing android.ts handler)
backend/src/handlers/
└── android.ts                        # MODIFY — add POST /android/input + GET /android/transactions/recent

backend/src/
└── types.ts                          # MODIFY — add InputResponse, CandidateTransaction types
```

**Structure Decision**: Option 3 (Mobile + API). Android extension follows existing feature-module pattern (`db/`, `network/`, `ui/`, `worker/`). Backend extension stays in `android.ts` per research Decision 4.

## Complexity Tracking

> No constitution violations require justification. One complexity note:

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|-------------------------------------|
| `PendingManualInput` separate from `PendingTransaction` | Manual inputs store raw text; notifications store parsed fields | Shared entity would force nullable columns for incompatible schemas (amount, bankName, paymentMethod all irrelevant for raw text queue) |
| `ManualInputSyncWorker` separate from `TransactionSyncWorker` | Different payload shape, different endpoint, different retry semantics (409 = parse error, not dedup) | Merging them adds conditional branches that obscure the already-tested sync logic |
