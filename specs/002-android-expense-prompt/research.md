# Research: Android Expense Prompt

**Branch**: `001-expense-tracker` | **Date**: 2026-05-06

All decisions below build on the existing 001-expense-tracker stack (Kotlin, Room, WorkManager, CF Workers TypeScript, Supabase). No new services or languages introduced.

---

## Decision 1: Command detection — client or server?

**Decision**: Server-side detection of `fee`/`refund` prefix.

**Rationale**: Keeps Android dumb — the app sends raw text to the backend exactly as typed. The backend inspects the prefix and routes to the appropriate handler. This means any future command additions require no Android update.

**Exception**: Android detects the `fee`/`refund` prefix locally only to decide whether to fetch the candidate list before the final POST (pure UI logic, no business logic).

---

## Decision 2: Offline queuing for manual inputs

**Decision**: New `PendingManualInput` Room entity; same WorkManager pattern as `PendingTransaction`.

**Rationale**: `PendingTransaction` stores parsed fields (amount, bankName, paymentMethod…) from notification parsing done on-device. Manual inputs store raw text — the parsing happens server-side via Gemini. A separate entity avoids forcing a shared schema between two structurally different queuing needs.

**Fields**: `id`, `text`, `parentTransactionId?`, `createdAt`, `retryCount`.

---

## Decision 3: Candidate list UX flow

**Decision**: Two-step submit for fee/refund commands.
1. User submits `fee [amount] [desc]` → app calls `GET /android/transactions/recent?q=[desc]`
2. Candidate list shown in-activity (RecyclerView, VISIBLE on detection); user taps choice or "None of these"
3. App posts `POST /android/input` with `parent_transaction_id` already resolved

**Rationale**: Avoids a round-trip disambiguation dance (server returning 3xx multi-choice). The candidate list fetch is cheap (≤20 rows). The final POST always has a definitive parent_transaction_id (or null for unlinked).

**Alternatives considered**: Bottom sheet dialog — marginally nicer UX but adds complexity; deferred for now.

---

## Decision 4: Backend endpoint design

**Decision**: Extend `android.ts` with two new routes:
- `POST /android/input` — main prompt endpoint (expense / fee / refund)
- `GET /android/transactions/recent` — candidate list for fee/refund selection

**Rationale**: All Android-client-facing routes live together in `android.ts`. No new handler file needed. The existing `POST /android/notifications` route for auto-captured notifications stays unchanged.

---

## Decision 5: Budget summary in response

**Decision**: `POST /android/input` response includes a `budget_summary` object: `{ total_spent, monthly_budget, remaining, percentage }`. Computed in-request using the existing `budget.ts` service.

**Rationale**: The spec requires displaying budget status after every successful entry (SC-001). Fetching it in a second request adds latency; bundling it in the response is cheaper and already done for Discord responses.
