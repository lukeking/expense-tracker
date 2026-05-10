<!--
SYNC IMPACT REPORT
==================
Version change: 1.0.0 → 1.0.0 (no change — validation pass only)
Validated: 2026-05-09

Modified principles: None

Added sections: None

Removed sections: None

Templates reviewed:
  ✅ .specify/templates/plan-template.md — Constitution Check gates match all five principles exactly
  ✅ .specify/templates/spec-template.md — no constitution-specific sections required
  ✅ .specify/templates/tasks-template.md — no principle-driven task types require update
  ✅ .specify/templates/commands/ — directory not present; no command files to review
  ✅ README.md — not present; no references to update

Deferred TODOs: None
-->

# Expense Tracker Constitution

## Core Principles

### I. Simplicity-First (Personal Tool)

This is a single-user personal tool. The system MUST NOT introduce multi-user,
multi-tenant, or generalized abstractions unless explicitly required by a future
requirement that has been ratified in this constitution.

- No user accounts, no RBAC, no access control layer beyond Discord webhook
  signature verification and the Android static API key.
- YAGNI applies strictly: three similar lines of code beat a premature abstraction.
- When in doubt between two approaches, choose the one with fewer moving parts.
- Adding a new project component (service, library, microservice) MUST be justified
  in the feature plan's Complexity Tracking table.

### II. Offline-First on Android

The Android companion app MUST function (capture and queue transactions) without
network connectivity.

- All parsed notification data MUST be persisted to a local Room database before
  any network call is attempted.
- WorkManager MUST be used for all background sync operations. Direct network calls
  from `NotificationListenerService` are PROHIBITED.
- Failed sync attempts MUST use exponential backoff; the system MUST NOT silently
  drop a transaction due to a transient network error.
- On receiving a `409 Conflict` from the server, the app MUST discard the duplicate
  without retrying.

### III. Serverless Boundary Compliance

All CF Workers backend code MUST respect the platform's hard constraints to avoid
silent failures or unexpected billing.

- Memory MUST stay within the 128 MB limit per isolate; CPU time MUST be written
  with the 10 ms free-tier limit in mind.
- No WebSocket connections, no long-polling, no Discord gateway. Discord integration
  MUST use the Interactions Webhook (HTTP POST) model exclusively.
- Any operation that may exceed 3 seconds (Gemini API call, Supabase write) MUST be
  deferred: return a Discord `type: 5` deferred response immediately then complete
  the operation inside `ctx.waitUntil()`.

### IV. Automation Over Manual Input

The primary goal is to minimize cognitive overhead of expense tracking.

- Credit card and mobile pay transactions MUST be captured automatically via the
  Android notification listener (target: ≥ 95% of monthly transactions).
- Manual Discord input MUST remain a single low-friction command:
  `/expense <amount> <description>` — no multi-step wizard, no required fields
  beyond amount.
- Receipt matching MUST be fully automatic for unambiguous cases (exactly one
  candidate receipt in the time window). User confirmation via Discord button
  MUST be required only for genuinely ambiguous matches.
- The system MUST proactively update (PATCH) a previously sent Discord message
  when a transaction is successfully matched to a receipt, so the user sees a
  richer record without additional input.

### V. Security at System Boundaries

All secrets MUST be stored server-side; no credential MUST ever be embedded in
client-facing artifacts or source code.

- Discord interactions endpoint MUST verify the ed25519 signature on every
  request before processing any payload. Requests failing verification MUST
  return `401` immediately.
- The Android API key MUST be stored as a CF Workers secret (`wrangler secret put
  ANDROID_API_KEY`) and validated in the worker. It MUST NOT appear in source code,
  `wrangler.toml`, or committed config files.
- The Supabase service role key MUST never be transmitted to any client (Android
  app or Discord user). All Supabase access goes through the CF Worker exclusively.
- Android clients MUST communicate only through the CF Worker HTTP API; direct
  Supabase connections from Android are PROHIBITED.

## Phased Development Constraints

Phase 1 (Core Engine) and Phase 2 (Automation) are the two delivery milestones.

- Phase 1 MUST be fully functional and independently deployable before any Phase 2
  work begins. Phase 1 scope: manual Discord expense entry, Gemini NLP parsing,
  monthly budget reporting.
- Phase 2 MUST extend Phase 1 without breaking it. Phase 2 scope: Android
  notification listener, e-invoice CSV import, automatic receipt matching.
- Each phase MUST be demonstrable independently using only the quickstart guide.
- No Phase 2 infrastructure (e.g., `pending_matches` table, CSV import handler) is
  required in Phase 1, but schema MUST be forward-compatible with Phase 2 additions.

## Quality Standards

Testing MUST cover the failure modes most likely to corrupt the single user's
financial data.

- All CF Workers request handlers MUST have unit tests using Vitest +
  `@cloudflare/vitest-pool-workers`. Tests MUST run against the actual Workers
  runtime (Miniflare), not mocked fetch.
- Android business logic (notification parser, sync worker, deduplication) MUST
  have unit tests using JUnit 4 + MockK.
- The following edge cases MUST have explicit test coverage:
  - Duplicate notification received within 5-minute window
  - Ambiguous match (two same-amount receipts in time window)
  - Discord ed25519 verification failure
  - Android notification received while offline
- Deduplication MUST be enforced at the server ingestion layer; client-side
  deduplication alone is insufficient.

## Governance

This constitution supersedes all other practices documented in this repository.
Ambiguity is resolved in favor of the principle that was most recently ratified.

- Amendments MUST include: a written rationale, a semver version bump, and an
  updated `Last Amended` date.
- Version bump rules: MAJOR for principle removal or incompatible redefinition;
  MINOR for new principle or materially expanded guidance; PATCH for clarifications
  or wording fixes.
- Every feature implementation plan (`plan.md`) MUST include a Constitution Check
  section that explicitly verifies compliance with each of the five Core Principles.
  A failing gate MUST block Phase 0 research unless justified in the Complexity
  Tracking table.
- All pull requests introducing new components, dependencies, or data-access
  patterns MUST reference the relevant principle(s) that authorize the change.

**Version**: 1.0.0 | **Ratified**: 2026-05-05 | **Last Amended**: 2026-05-05
