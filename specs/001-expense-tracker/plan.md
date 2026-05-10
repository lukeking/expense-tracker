# Implementation Plan: Expense Tracker (Discord Bot + Android)

**Branch**: `001-expense-tracker` | **Date**: 2026-05-05 (updated 2026-05-06) | **Spec**: [proposal.md](../../proposal.md)
**Input**: Feature specification from `proposal.md` (clarified 2026-05-05, payment model clarified 2026-05-06)

## Summary

Build a personal, single-user automated expense tracking system combining: an Android notification listener (Kotlin) that intercepts bank push notifications; a Cloudflare Workers TypeScript backend that processes events, calls Gemini for NLP parsing, and manages matching logic; Supabase (PostgreSQL) for storage; Discord Interactions Webhook as the primary UI; and user-driven e-invoice CSV import for receipt reconciliation. Phase 1 delivers manual Discord input + AI parsing; Phase 2 adds Android automation and receipt matching.

## Technical Context

**Language/Version**: TypeScript (CF Workers runtime, ES2022 + V8 isolates), Kotlin 1.9 (Android, API 26+)
**Primary Dependencies**:
  - Backend: Hono (routing), `@supabase/supabase-js` v2, `@noble/ed25519` (Discord sig verification), Gemini API (raw HTTP)
  - Android: NotificationListenerService, WorkManager, Retrofit/OkHttp, Room (local persistence), Kotlin Coroutines
  - Testing: Vitest + `@cloudflare/vitest-pool-workers` (backend), JUnit 4 + MockK (Android)
**Storage**: Supabase hosted PostgreSQL — single-user schema (no RLS), service role key on backend only
**Testing**: Vitest + `@cloudflare/vitest-pool-workers` (backend unit/integration), JUnit 4 + MockK (Android unit)
**Target Platform**: Cloudflare Workers (serverless, 128MB memory, 10ms CPU free tier), Android 8.0+ (API 26+)
**Project Type**: Personal tool — serverless backend + Discord bot + Android companion app
**Performance Goals**: Discord interactions must respond <3s (Discord hard timeout); notification ingestion <1s P95
**Constraints**: CF Workers 128MB memory / 10ms CPU (free tier); Android must handle offline with WorkManager exponential backoff; no user accounts — single static API key for Android auth
**Scale/Scope**: Single user, ~50–100 transactions/month, ~30–50 invoices/month
**Payment Methods**: `credit_card` | `prepaid_wallet` | `easy_card` | `bank_account` | `cash`; optional `wallet` field (`'line_pay'` | `'google_pay'`) for credit_card/prepaid_wallet; multi-app notification dedup via upsert on `amount + 3-minute window`

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution file (`.specify/memory/constitution.md`) is an unfilled template — no project-specific principles or gates have been ratified. No constitution violations possible at this stage. **Recommend running `/speckit-constitution` after planning to establish project principles.**

Post-design re-check: No violations introduced. Architecture is appropriately simple for a single-user personal tool (no unnecessary abstractions, no premature scaling).

## Project Structure

### Documentation (this feature)

```text
specs/001-expense-tracker/
├── plan.md              # This file (/speckit-plan output)
├── research.md          # Phase 0 output: tech decisions and rationale
├── data-model.md        # Phase 1 output: DB schema + TypeScript types
├── quickstart.md        # Phase 1 output: setup guide
├── contracts/           # Phase 1 output: API contracts
│   ├── discord-webhook.md
│   └── android-api.md
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/                         # Cloudflare Workers TypeScript project
├── src/
│   ├── index.ts                 # Worker entry point (Hono router + Cron handler)
│   ├── handlers/
│   │   ├── discord.ts           # Discord interactions (slash commands + component buttons)
│   │   └── android.ts           # Android notification ingestion endpoint
│   ├── services/
│   │   ├── gemini.ts            # NLP parsing via Gemini API (raw HTTP)
│   │   ├── matcher.ts           # Amount + date matching algorithm
│   │   ├── budget.ts            # Monthly budget computation
│   │   └── discord-notify.ts    # Proactive Discord message sender (PATCH/POST)
│   ├── db/
│   │   ├── client.ts            # Supabase client singleton
│   │   └── queries.ts           # Typed DB query functions
│   └── types.ts                 # Shared TypeScript types
├── tests/
│   ├── handlers/
│   ├── services/
│   └── db/
├── supabase/
│   └── schema.sql               # DB schema migration
├── scripts/
│   └── register-commands.ts     # Discord slash command registration
├── wrangler.toml
└── package.json

android/                         # Kotlin Android companion app
├── app/src/main/
│   ├── java/com/expenses/
│   │   ├── service/
│   │   │   └── NotificationListenerService.kt
│   │   ├── worker/
│   │   │   └── TransactionSyncWorker.kt
│   │   ├── network/
│   │   │   └── ApiClient.kt
│   │   ├── db/
│   │   │   ├── LocalDatabase.kt   # Room DB for offline queue
│   │   │   └── PendingTransaction.kt
│   │   └── parser/
│   │       └── NotificationParser.kt  # Regex-based notification parsing
│   └── res/
├── app/src/test/
│   └── java/com/expenses/
│       ├── parser/
│       └── worker/
└── build.gradle.kts
```

**Structure Decision**: Multi-component project (backend + Android). No frontend — Discord is the UI. Backend is a standalone Cloudflare Workers project; Android is a standalone Gradle project. Both live in the same repository under separate top-level directories for monorepo simplicity.

## Complexity Tracking

> No constitution violations requiring justification.
