# Phase 0 Research: Local End-to-End Test Stack

**Feature**: 028-e2e-test-stack | **Date**: 2026-06-13

Decisions resolving the Technical Context unknowns. The three clarified spec decisions
(catalog snapshot, hybrid orchestration, per-test reset) are taken as given.

## D1 — Local datastore: Supabase CLI stack (Docker)

**Decision**: Use the Supabase CLI local stack (`supabase start`) as the local datastore. Run `supabase init` to create `backend/supabase/config.toml` (does not exist yet; migrations already live in `backend/supabase/migrations/`).

**Rationale**: The backend (`backend/src/db/client.ts`) talks to Supabase through `@supabase/supabase-js` against the PostgREST REST API and Postgres RPCs (`summary_rpc`, `transaction_periods_rpc`). Only the full local stack (Postgres + PostgREST + GoTrue) serves those calls unchanged. `supabase db reset` applies the existing migrations, giving schema parity with production with zero backend code changes.

**Alternatives considered**:
- *Native/bare Postgres (no Docker)* — rejected: cannot serve supabase-js REST/RPC calls; would force rewriting the backend onto a raw `pg` driver.
- *Second cloud Supabase project* — rejected by the spec (cost, CI secrets, not resettable, not offline).

**⚠ Prerequisite risk**: Neither `docker` nor the `supabase` CLI is currently on PATH in this WSL2 environment. Both are one-time installs (covered by SC-001's "excluding one-time tool installation" carve-out), but **the suite cannot run until they exist**. Docker must have WSL2 integration enabled. This is the first task and the single biggest external dependency.

## D2 — Port allocation under WSL2 constraints

**Decision**: PWA dev server on **5300** (the WSL2 Hyper-V excluded range is 5144–5243; Vite's default 5173 falls inside it). Backend `wrangler dev` on **8787** (default, outside the range). Supabase local services on their defaults (API 54321, DB 54322, Studio 54323) — all outside the blocked range.

**Rationale**: Matches the established project convention (memory: "use `pnpm dev --port 5300`"). No Supabase default port collides with 5144–5243, so only Vite needs the override.

**Alternatives**: Remapping Supabase ports — unnecessary, adds config surface.

## D3 — Stack orchestration (hybrid, per clarification)

**Decision**: A single Playwright run (the test command) auto-starts **backend (`wrangler dev`)** and **PWA (Vite on 5300)** via Playwright's `webServer` config (two entries, each with a `url` readiness probe). **Local Supabase is a documented prerequisite** the developer starts/resets separately (`supabase start`, `supabase db reset`).

**Rationale**: Supabase boot is the slow/heavy step (Docker containers) and is the reset target, so it is naturally kept running. `wrangler dev` and Vite start in seconds and Playwright's `webServer.url` gives reliable readiness waits — keeping "run the suite" effectively one command (FR-007) and the run fast (SC-002).

**Alternatives**: Fully self-orchestrating (boot Supabase in the hot path) — rejected: slow, brittle. Assume-everything-running — rejected: more manual steps, easy to run against a stale stack.

## D4 — Backend env wiring for the local stack

**Decision**: Commit a **template** `backend/.dev.vars.e2e.example`; the active **`backend/.dev.vars.e2e`** is **gitignored** and created at setup via `cp .dev.vars.e2e.example .dev.vars.e2e`. Start the backend with `wrangler dev --env e2e` (define `[env.e2e]` in `wrangler.toml`). Template values:
- `SUPABASE_URL` → `http://127.0.0.1:54321`
- `SUPABASE_SERVICE_ROLE_KEY` → the **well-known static local Supabase service-role JWT** (identical on every local install; documented publicly by Supabase — not a secret)
- `ANDROID_API_KEY` → a fixed literal test key `e2e-test-key` (must match `TEST_API_KEY` in `e2e/fixtures/auth.ts`, the single source of truth)
- `PWA_ORIGIN` → `http://localhost:5300`

**Rationale (Principle V compliance — analyze finding C1)**: Principle V forbids `ANDROID_API_KEY` from appearing in committed config files. Even though the value here is a local throwaway, we keep the **operative** vars file out of git entirely and commit only an `.example` template — mirroring the repo's existing `!.env.example` gitignore convention. The one-line `cp` setup step preserves FR-009 (clean-checkout reproducibility). The `--env e2e` separation leaves the developer's personal `.dev.vars` untouched.

**Alternatives**: Committing the active `.dev.vars.e2e` (original plan) — rejected: places an `ANDROID_API_KEY=` line in a committed config file, conflicting with Principle V's letter. Injecting via `wrangler dev` env — rejected: wrangler bindings come from `.dev.vars`/`wrangler.toml`, not arbitrary `process.env`. Reusing the personal `.dev.vars` — rejected: clobbers the dev's own config and may point at the cloud.

## D5 — Auth seam in the browser

**Decision**: Before each test navigation, seed `localStorage['expense_api_key']` with the same literal test key as the backend's `ANDROID_API_KEY` (via Playwright `addInitScript` / storage state), so `apiFetch` sends `Authorization: Bearer e2e-test-key`.

**Rationale**: `/pwa/*` is gated by `androidAuth` (`Bearer` vs `env.ANDROID_API_KEY`); the PWA reads the key from `localStorage`. Seeding it bypasses the manual key-entry screen deterministically.

**Alternatives**: Driving the key-entry UI each test — rejected: slower, irrelevant to the flows under test.

## D6 — Category catalog seeding (snapshot → SQL)

**Decision**: Derive a SQL seed from the existing `backend/supabase/seed/categories.md` snapshot. Add a small generator (`backend/supabase/seed/build-seed.ts`) that parses the Markdown rows and emits idempotent `INSERT … ON CONFLICT (major, subcategory) DO NOTHING` statements into `backend/supabase/seed.sql`. Wire `seed.sql` into `config.toml` so `supabase db reset` loads it after migrations.

**Rationale**: `categories.md` is already the committed human-readable snapshot of the live ~133-row catalog (the Q1=A artifact). Migrations 011/012 seed only an initial subset and run first; `ON CONFLICT DO NOTHING` lets the full snapshot upsert cleanly on top. A generator keeps the human-readable `.md` as the single source of truth and avoids hand-maintaining parallel SQL.

**Alternatives**: Hand-written `seed.sql` (dual maintenance, drift risk); regenerating the snapshot directly as SQL (loses the readable `.md`); migrations-only (rejected by spec — not representative).

**Refresh path**: re-run `GET /pwa/categories` (Bearer `$ANDROID_API_KEY` from env) → overwrite `categories.md` rows → re-run `build-seed.ts`. The fetch loads the key from env; the value never enters source or transcript.

## D7 — Per-test reset (fast truncate + reseed)

**Decision**: A reset helper (`e2e/fixtures/reset-db.ts`) connects directly to local Postgres (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`, the standard local credentials) using `pg`, and in a `beforeEach` runs: `TRUNCATE` of the transactional tables (`transactions`, `transaction_items`, `transaction_adjustments`, `transaction_edit_history`) `RESTART IDENTITY CASCADE`, then re-inserts the deterministic baseline transaction set. The `categories` table is **not** truncated (reference data seeded once by `db reset`).

**Rationale**: Per-test reset (clarified) demands a sub-second operation; full `supabase db reset` (re-runs all migrations) is far too slow to run per test. Truncating only transactional tables and re-inserting a tiny baseline is fast and gives every test the identical baseline (FR-002, SC-003). Direct Postgres access is the simplest reset path (the backend exposes no truncate endpoint, nor should it).

**Alternatives**: `supabase db reset` per test (too slow); transaction-rollback isolation (awkward across the HTTP boundary to a separate Worker process); deleting via the API (slow, needs delete endpoints).

## D8 — E2E project location & tooling

**Decision**: A new top-level **`e2e/`** package (own `package.json`, `playwright.config.ts`, `tests/`, `fixtures/`). Dependencies: `@playwright/test`, `pg`.

**Rationale**: Keeps E2E dependencies (Playwright browsers, `pg`) out of the `backend` (Workers) and `pwa` (browser bundle) dependency trees, which must stay lean. The repo already uses per-package `package.json` with no workspace linker, so a third sibling package fits the existing layout.

**Alternatives**: Tests under `pwa/` — rejected: pollutes the PWA bundle deps and conflates unit/build tooling with E2E.

## D9 — Baseline transaction fixture for summary assertions

**Decision**: A small, fixed set of baseline transactions (a handful spanning ≥2 categories and a known period) defined once as SQL/TS and inserted by the reset helper. The summary test asserts the exact aggregate of this known set, including one category or period filter.

**Rationale**: FR-006 needs deterministic expected aggregates. A tiny hand-authored set keeps the expected totals obvious and the test readable. Per-test reset guarantees the add-expense test's writes never perturb these numbers.

**Alternatives**: Asserting on a subset of arbitrary data — rejected: brittle, not deterministic.
