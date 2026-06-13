# Implementation Plan: Local End-to-End Test Stack

**Branch**: `028-e2e-test-stack` | **Date**: 2026-06-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/028-e2e-test-stack/spec.md`

## Summary

Stand up a reproducible, local-only test stack and an automated regression suite for the PWA's two core journeys (add-expense, view-summary). The local datastore is the Supabase CLI stack (`supabase start`), the backend runs under `wrangler dev`, and Playwright drives the real PWA in a browser. A single Playwright command auto-starts the backend + PWA (Supabase is a kept-running prerequisite), resets the DB to an identical seed baseline before each test, and asserts observable outcomes. The category catalog is seeded from the existing `categories.md` snapshot of the live ~133-row catalog; a small baseline transaction set backs the summary assertions. No production data or credentials are ever touched.

## Technical Context

**Language/Version**: TypeScript 5.x on Node ≥18 (pnpm). Backend targets the Cloudflare Workers runtime via `wrangler dev`; PWA is React 18 + Vite 5.
**Primary Dependencies**: New — `@playwright/test`, `pg` (reset helper), Supabase CLI (tool), Docker (tool). Existing — Hono, `@supabase/supabase-js`, React, `@tanstack/react-query`, Vite.
**Storage**: Local Supabase stack (Postgres 15 + PostgREST + GoTrue) via Docker; schema from `backend/supabase/migrations/*` applied by `supabase db reset`.
**Testing**: Playwright (new E2E suite) — complements existing backend Vitest (`@cloudflare/vitest-pool-workers`). No change to existing unit tests.
**Target Platform**: Local developer machine (WSL2 on Windows).
**Project Type**: Web application (Cloudflare Worker backend + Vite PWA) plus a new top-level `e2e/` test package.
**Performance Goals**: Full suite < 5 min (SC-002); per-test reset sub-second (truncate + reseed); cold start to green < 15 min excluding tool install (SC-001).
**Constraints**: WSL2 Hyper-V blocks ports 5144–5243 → Vite on 5300. Docker + Supabase CLI required (neither currently installed). Zero production credentials; local-only well-known keys.
**Scale/Scope**: 2 automated journeys at launch; ~133 category rows; a handful of baseline transactions.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First** — Single-user, no new runtime abstractions or multi-user patterns. Adds test-only components (Playwright `e2e/` package, Supabase local config); both justified in Complexity Tracking below. No production code changes.
- [x] **II. Offline-First on Android** — N/A. No Android changes.
- [x] **III. Serverless Boundary Compliance** — N/A. The backend Worker runs unmodified under `wrangler dev`; no new handlers, no gateway/WebSocket, no slow-op changes.
- [x] **IV. Automation Over Manual Input** — N/A. No change to capture, parsing, or receipt-matching flows.
- [x] **V. Security at System Boundaries** — PASS. The stack uses only local, non-production credentials. The operative `backend/.dev.vars.e2e` is **gitignored**; only a `.dev.vars.e2e.example` template is committed (mirroring the repo's `!.env.example` convention), so no `ANDROID_API_KEY=` line lands in a committed config file (analyze finding C1). No production secret is committed or transmitted. Catalog-snapshot refresh loads `$ANDROID_API_KEY` from env (never inlined). FR-001/FR-011 enforce zero production data access.

*Post-Phase-1 re-check*: still PASS — design introduces no production code paths and no new secrets.

## Project Structure

### Documentation (this feature)

```text
specs/028-e2e-test-stack/
├── plan.md              # This file
├── spec.md              # Feature spec (+ Clarifications)
├── research.md          # Phase 0 decisions (D1–D9)
├── data-model.md        # Phase 1 — seed fixture + baseline entities
├── quickstart.md        # Phase 1 — how to run the suite
├── contracts/
│   └── test-harness.md   # Phase 1 — integration seams the suite depends on
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
e2e/                          # NEW — Playwright test package
├── package.json              # @playwright/test, pg
├── playwright.config.ts      # webServer: wrangler dev + vite(5300); readiness probes
├── fixtures/
│   ├── reset-db.ts           # truncate transactional tables + reseed baseline (beforeEach)
│   ├── baseline.ts           # deterministic baseline transactions for summary assertions
│   └── auth.ts               # seed localStorage['expense_api_key'] = test key
└── tests/
    ├── add-expense.spec.ts   # US2 — P1 flow
    └── view-summary.spec.ts  # US3 — read/aggregation flow

backend/
├── supabase/
│   ├── config.toml           # NEW — `supabase init`; ports + seed wiring
│   ├── seed.sql              # NEW — generated category upserts (from categories.md)
│   ├── seed/
│   │   ├── categories.md     # existing live-catalog snapshot (source of truth)
│   │   └── build-seed.ts     # NEW — categories.md → seed.sql generator
│   └── migrations/*          # existing schema (unchanged)
├── wrangler.toml             # + [env.e2e] block
└── .dev.vars.e2e.example     # NEW — committed template; active .dev.vars.e2e is gitignored (cp on setup)
```

**Structure Decision**: Add a third sibling package `e2e/` alongside the existing per-package `backend/` and `pwa/` (the repo has no workspace linker — separate `package.json` per project). Local-stack config lives under the existing `backend/supabase/` tree next to the migrations and the catalog snapshot it already hosts. No production source files are modified.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| New component: Playwright E2E package (`e2e/`) | FR-004/005/006 require driving the real PWA UI against a real backend + DB and asserting persisted outcomes | Extending backend Vitest (Miniflare) cannot render the PWA or assert real browser→Worker→Postgres flows |
| New tooling: Supabase CLI local stack (Docker) | Backend reaches Supabase via PostgREST + RPCs (`summary_rpc`); only the full local stack serves those calls unchanged | A bare/native Postgres can't answer supabase-js REST/RPC calls without rewriting the backend onto a raw `pg` driver |

## Phase Notes

**Phase 0 (research.md)** — resolved: local datastore choice (D1), port plan (D2), orchestration (D3), backend env wiring (D4), browser auth seam (D5), catalog snapshot→SQL (D6), per-test reset mechanism (D7), e2e package location (D8), baseline fixture (D9). One open external risk: Docker + Supabase CLI are not yet installed.

**Phase 1 (this command)** — produced data-model.md (seed fixture + baseline + reset contract), contracts/test-harness.md (auth/env/reset seams), quickstart.md (prerequisites + run commands). Agent context (`CLAUDE.md`) updated to point here.

**Phase 2 (/speckit-tasks)** — will decompose into: install/verify prerequisites; `supabase init` + config.toml + port wiring; seed generator + seed.sql; `[env.e2e]` + `.dev.vars.e2e`; `e2e/` scaffold (Playwright config + webServer); reset + auth fixtures; add-expense spec; view-summary spec; docs; the deliberate-regression check (SC-004).
