# Phase 1 Contracts: Test-Harness Integration Seams

**Feature**: 028-e2e-test-stack | **Date**: 2026-06-13

This feature exposes **no new public API**. Its "contracts" are the existing integration
seams the suite depends on. If any of these change in production code, the harness must
change with them — they are the coupling points.

## C1 — Auth seam (browser ↔ backend)

- The PWA sends `Authorization: Bearer <key>` where `<key>` = `localStorage['expense_api_key']` (`pwa/src/api/client.ts`).
- The backend gates `/pwa/*` via `androidAuth`: `Bearer` prefix required, then `key === env.ANDROID_API_KEY` else `401` (`backend/src/middleware/android-auth.ts`).
- **Harness obligation**: set `localStorage['expense_api_key'] = 'e2e-test-key'` before app code runs (Playwright `addInitScript` or storage state), with backend `ANDROID_API_KEY = 'e2e-test-key'`.

## C2 — Backend env contract (`[env.e2e]`)

`wrangler dev --env e2e` must provide (from `backend/.dev.vars.e2e`, which is gitignored and created at setup via `cp .dev.vars.e2e.example .dev.vars.e2e`):

| Var | Local value |
|-----|-------------|
| `SUPABASE_URL` | `http://127.0.0.1:54321` |
| `SUPABASE_SERVICE_ROLE_KEY` | well-known static local service-role JWT |
| `ANDROID_API_KEY` | `e2e-test-key` |
| `PWA_ORIGIN` | `http://localhost:5300` |

These mirror the production binding names (`backend/src/types.ts` `Env`) so no backend code changes.

## C3 — PWA env contract

- `VITE_API_BASE` → `http://localhost:8787` (so `apiFetch` targets the local Worker; `pwa/src/api/client.ts`).
- Vite served on **5300** (WSL2 port constraint).

## C4 — Datastore reset contract (harness ↔ Postgres)

- Connection: `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (standard local Supabase Postgres).
- Before each test: `TRUNCATE <transactional tables> RESTART IDENTITY CASCADE`, then insert the baseline transaction set. **Do not** truncate `categories`.
- Post-condition: every test observes the identical seed baseline (FR-002, invariants I1–I2 in data-model.md).

## C5 — Orchestration contract (Playwright `webServer`)

- Playwright auto-starts two servers with readiness probes:
  - Backend: `wrangler dev --env e2e` → ready when `http://localhost:8787` responds.
  - PWA: Vite on 5300 → ready when `http://localhost:5300` responds.
- **Precondition (not started by Playwright)**: `supabase start` is running and `supabase db reset` has been applied (categories + schema present). This is the documented prerequisite (FR-012).

## C6 — User-flow assertions (existing UI, no new contract)

The specs assert against the *existing* PWA surface:
- **add-expense** (`pwa/src/screens/EntryScreen.tsx`): amount, category picker, item row(s), payment pills, submit → success toast; then verify persistence via the app (transactions/summary view).
- **view-summary** (`pwa/src/screens/SummaryScreen.tsx`): totals reflect the baseline set; at least one category/period filter narrows results correctly.

Selectors/roles are chosen during implementation; stable `aria-label`/text already present in those components are preferred over brittle CSS paths.
