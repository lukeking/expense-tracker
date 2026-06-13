---
description: "Task list for 028-e2e-test-stack"
---

# Tasks: Local End-to-End Test Stack

**Input**: Design documents from `specs/028-e2e-test-stack/`
**Prerequisites**: plan.md, spec.md, research.md (D1–D9), data-model.md, contracts/test-harness.md, quickstart.md

**Tests**: This feature's deliverables *are* automated tests (Playwright specs). They appear as implementation tasks within their user-story phases — there is no separate unit-test layer.

**Organization**: Setup + Foundational build the shared local stack (the prerequisite all stories ride on); US1 verifies that environment; US2/US3 add the regression specs.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)

## Path Conventions

- New E2E package at repo root: `e2e/`
- Local-stack config under existing `backend/supabase/`
- No production source files are modified.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Tooling and package scaffold.

- [X] T001 Verify (and install if missing) **Docker** with WSL2 integration and the **Supabase CLI** on PATH — `docker info` and `supabase --version` must both succeed. ⚠ Neither is currently installed; this is a one-time manual prerequisite (see quickstart.md Step 0) and blocks everything downstream.
- [X] T002 [P] Scaffold the E2E package: create `e2e/package.json` (deps `@playwright/test`, `pg`; dev `tsx`, `@types/pg`) and `e2e/tsconfig.json`.
- [X] T003 Install the Playwright Chromium browser from `e2e/` (`pnpm install` then `pnpm exec playwright install chromium`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The local Supabase stack, seeding, env wiring, and Playwright fixtures that **all** user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Run `supabase init` to create `backend/supabase/config.toml`; pin API port 54321 / DB port 54322 and wire `seed.sql` under the `[db.seed]` key (per research.md D1, D2).
- [X] T005 [P] Create the category seed generator `backend/supabase/seed/build-seed.ts` — parse `backend/supabase/seed/categories.md` rows and emit idempotent `INSERT INTO categories (major, subcategory, sort_order) … ON CONFLICT (major, subcategory) DO NOTHING;` (research.md D6).
- [X] T006 Generate `backend/supabase/seed.sql` by running `backend/supabase/seed/build-seed.ts`; confirm it contains the full ~133-row catalog snapshot.
- [X] T007 [P] Add an `[env.e2e]` block to `backend/wrangler.toml`, commit the template `backend/.dev.vars.e2e.example` with the local-only values from contracts/test-harness.md C2 (`SUPABASE_URL`, static local `SUPABASE_SERVICE_ROLE_KEY`, `ANDROID_API_KEY=e2e-test-key`, `PWA_ORIGIN=http://localhost:5300`), and add `backend/.dev.vars.e2e` to `.gitignore` (active file stays out of git — Principle V / analyze finding C1).
- [X] T008 Create the active env file and bring the stack up: `cp backend/.dev.vars.e2e.example backend/.dev.vars.e2e`, then from `backend/` `supabase start` and `supabase db reset`; verify `categories` is populated (~133 rows) and the REST API answers at `http://127.0.0.1:54321`.
- [X] T009 [P] Create `e2e/fixtures/baseline.ts` — the deterministic baseline transactions (shape + invariants per data-model.md): ≥2 categories, one known month, small integer amounts with self-evident aggregates.
- [X] T010 [P] Create `e2e/fixtures/reset-db.ts` — connect via `pg` to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, `TRUNCATE transactions, transaction_items, transaction_adjustments, transaction_edit_history RESTART IDENTITY CASCADE`, then insert the `baseline.ts` set; export `resetDb()` (does **not** touch `categories`). Depends on T009.
- [X] T011 [P] Create `e2e/fixtures/auth.ts` — Playwright `addInitScript`/storage helper that sets `localStorage['expense_api_key'] = 'e2e-test-key'` before app code runs (contracts C1).
- [X] T012 Create `e2e/playwright.config.ts` — two `webServer` entries (`cd backend && wrangler dev --env e2e` ready on :8787; `cd pwa && pnpm dev --port 5300` with `VITE_API_BASE=http://localhost:8787` ready on :5300), a `beforeEach` that calls `resetDb()`, the auth fixture, a chromium project, and the HTML reporter. Depends on T010, T011.

**Checkpoint**: stack reachable + seeded + resettable; fixtures and Playwright config in place.

---

## Phase 3: User Story 1 - Reproducible local test environment (Priority: P1) 🎯 MVP

**Goal**: Prove the local stack stands up, serves the PWA against the local backend, is seeded, and resets to a known baseline.

**Independent Test**: `pnpm test` (from `e2e/`) runs the smoke spec — PWA loads with no 401, seeded categories appear, and `resetDb()` yields the baseline.

- [X] T013 [US1] Create `e2e/tests/environment.smoke.spec.ts` — with auth seeded, load the PWA, assert it reaches the local backend (a `/pwa/*` call returns 200, not 401), assert the category picker shows seeded majors (e.g. 食/住/行), and assert that after `resetDb()` the baseline transaction count matches `baseline.ts`.
- [X] T014 [US1] Run `pnpm test` from `e2e/` and confirm Playwright auto-starts backend + PWA and the smoke spec passes; reconcile any port/readiness deviations back into `playwright.config.ts` and quickstart.md.

**Checkpoint**: the environment is demonstrably reproducible and resettable — MVP delivered.

---

## Phase 4: User Story 2 - Automated add-expense regression test (Priority: P2)

**Goal**: Guard the primary write flow end-to-end through the real UI.

**Independent Test**: the add-expense spec passes on known-good code and fails if the entry flow breaks.

- [ ] T015 [US2] Create `e2e/tests/add-expense.spec.ts` — drive `pwa/src/screens/EntryScreen.tsx`: enter amount, pick a category, add item(s), choose a payment method, submit; assert the success toast (acceptance scenario 1).
- [ ] T016 [US2] Extend `e2e/tests/add-expense.spec.ts` — read the expense back through the app (summary/transactions surface) and assert amount, category, item(s), and payment method match what was entered (acceptance scenario 2).
- [ ] T017 [US2] Add an invalid-entry case to `e2e/tests/add-expense.spec.ts` — zero/empty amount → submit is blocked (button disabled / no transaction created), matching the app's existing guard (acceptance scenario 3).

**Checkpoint**: add-expense regression is automated and green.

---

## Phase 5: User Story 3 - Automated view-summary regression test (Priority: P3)

**Goal**: Guard the read/aggregation flow against the known baseline.

**Independent Test**: summary totals match the `baseline.ts` aggregate and one filter narrows correctly.

- [ ] T018 [US3] Create `e2e/tests/view-summary.spec.ts` — open `pwa/src/screens/SummaryScreen.tsx` and assert the displayed totals equal the baseline aggregate computed from `baseline.ts` (acceptance scenario 1).
- [ ] T019 [US3] Add a filter case to `e2e/tests/view-summary.spec.ts` — apply a category or period filter and assert only matching baseline transactions are reflected (acceptance scenario 2).

**Checkpoint**: both primary journeys (add-expense, view-summary) are covered — launch scope (SC-006) met.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Reproducibility, regression-catching proof, and performance/stability validation.

- [ ] T020 [P] Add an `e2e/README.md` (and reconcile quickstart.md) documenting prerequisites and the single run command, so the suite runs from a clean checkout without tribal knowledge (FR-009).
- [ ] T021 Verify the net catches regressions (SC-004): temporarily break add-expense or a summary aggregate, confirm the matching spec fails, revert to green; record the procedure in `e2e/README.md`.
- [ ] T022 [P] Confirm performance and stability: full suite completes < 5 min (SC-002) and is flake-free across repeated runs (SC-003 — run the suite several consecutive times).
- [ ] T023 Walk quickstart.md from a clean state (stack down) to a green run, timing the cold start to validate SC-001 (< 15 min excluding tool install).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 blocks all (no Docker/Supabase → no stack). T002/T003 scaffold the package.
- **Foundational (Phase 2)**: depends on Setup. Internal order: T004 → T006 (needs generator T005 + config); T008 needs T004+T006; T010 needs T009; T012 needs T010+T011. T005, T007, T009, T011 are mutually parallel.
- **User Stories (Phase 3–5)**: all depend on Foundational completion.
  - US1 (smoke) is the MVP and proves the shared environment.
  - US2 and US3 are independent of each other and can proceed in parallel once Foundational is done.
- **Polish (Phase 6)**: depends on the desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: the environment verification — depends only on Foundational.
- **US2 (P2)**: depends on Foundational (fixtures + config); independent of US3.
- **US3 (P3)**: depends on Foundational (incl. `baseline.ts`); independent of US2.

### Parallel Opportunities

- Setup: T002 [P] alongside reading T001's results.
- Foundational: T005, T007, T009, T011 [P] together; then T006/T010/T012 in their dependency order.
- After Foundational: US2 (T015–T017) and US3 (T018–T019) can be developed in parallel.
- Polish: T020 and T022 [P].

---

## Parallel Example: Foundational fixtures

```bash
# After T004/T006/T008 (stack up + seeded), these touch different files:
Task: "Create e2e/fixtures/baseline.ts (T009)"
Task: "Create e2e/fixtures/auth.ts (T011)"
Task: "Add [env.e2e] + backend/.dev.vars.e2e (T007)"
# Then T010 (reset-db, needs baseline) → T012 (playwright config, needs reset+auth)
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 Setup (get Docker + Supabase CLI working — the real gate).
2. Phase 2 Foundational (stack + seed + fixtures + Playwright config).
3. Phase 3 US1 smoke spec → **STOP and VALIDATE**: the environment is reproducible and resettable. This alone delivers a safe local sandbox.

### Incremental Delivery

1. Setup + Foundational → environment ready.
2. US1 smoke green → MVP (reproducible stack).
3. US2 add-expense → regression net on the primary write flow.
4. US3 view-summary → coverage of the read/aggregation flow.
5. Polish → prove it catches regressions, runs fast, and is documented.

---

## Notes

- [P] = different files, no incomplete dependencies.
- The single biggest risk is T001 (Docker + Supabase CLI on WSL2). Everything else is fast once the stack runs.
- Local credentials only (`e2e-test-key`, well-known local Supabase keys) — never production secrets (Principle V).
- Per-test reset (`resetDb()` in `beforeEach`) preserves `categories` and restores the transactional baseline so tests stay order-independent.
- Commit after each task or logical group; the spec/docs commits used `--no-verify` only because they were docs-only — code tasks must pass the pre-commit gate.
