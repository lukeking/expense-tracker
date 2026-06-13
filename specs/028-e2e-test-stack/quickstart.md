# Quickstart: Running the Local E2E Suite

**Feature**: 028-e2e-test-stack | **Date**: 2026-06-13

How to go from a clean checkout to a green end-to-end run. Targets SC-001 (< 15 min,
excluding the one-time tool installs in Step 0).

## Step 0 — One-time prerequisites (excluded from the 15-min budget)

Set up once:

1. **Docker** with WSL2 integration enabled (Docker Desktop → Settings → Resources → WSL Integration, or Docker Engine inside WSL2). Verify: `docker info`.
2. **Supabase CLI** — installed as a backend dev-dependency, invoked via `pnpm exec supabase`. Verify: `pnpm -C backend exec supabase --version`. (Install if missing: `pnpm -C backend add -D supabase`.)
3. **Playwright browsers**: from `e2e/`, `pnpm install` then `pnpm exec playwright install chromium`.

> Without Docker + the Supabase CLI the local datastore cannot start, and the suite cannot run.

## Step 1 — Start the local datastore (prerequisite, kept running)

```bash
cd backend
pnpm exec supabase start          # boots Postgres + PostgREST (Docker)
pnpm exec supabase db reset       # applies migrations (incl. 000_base_schema) + seed.sql + seed-grants.sql
bash scripts/gen-e2e-dev-vars.sh  # writes the gitignored .dev.vars.e2e (service-role key pulled from supabase status)
```

`gen-e2e-dev-vars.sh` reads the local service-role key from `supabase status` at runtime
and writes `.dev.vars.e2e` — so no key is ever committed or copied by hand. (The committed
`.dev.vars.e2e.example` documents the variable names only.)

Leave this stack running between test runs. Re-run `supabase db reset` only after schema
or category-snapshot changes (the suite resets transactional data itself, per test).

## Step 2 — Run the suite (single command)

```bash
cd e2e
pnpm test                # = playwright test
```

Playwright auto-starts the backend (`wrangler dev --env e2e`, :8787) and the PWA
(Vite, :5300), waits for both, resets the DB to the baseline before each test, and runs:

- `add-expense.spec.ts` — enters and submits an expense, verifies it persisted.
- `view-summary.spec.ts` — verifies summary totals + one filter against the baseline.

Expected result: **all tests pass** in under 5 minutes (SC-002).

### Useful variants

```bash
pnpm exec playwright test --headed     # watch the browser (debugging)
pnpm exec playwright test --ui          # Playwright UI mode
pnpm exec playwright show-report        # open the last HTML report
```

## Step 3 — Confirm it catches regressions (SC-004)

Sanity-check the net actually works:

1. Temporarily break a flow (e.g., disable the submit button or a summary aggregate).
2. Run `pnpm test` → the corresponding spec **fails**.
3. Revert → green again.

## Refreshing the category snapshot (occasional)

When the live catalog changes meaningfully:

```bash
# Fetch live catalog (key loaded from env — never inline it)
curl -s -H "Authorization: Bearer $ANDROID_API_KEY" \
  https://<prod-worker>/pwa/categories > /tmp/categories.json
# Update backend/supabase/seed/categories.md rows from that, then regenerate SQL:
cd backend && pnpm exec tsx supabase/seed/build-seed.ts   # → supabase/seed.sql
pnpm exec supabase db reset                               # reload
```

## Ports (WSL2)

| Service | Port | Note |
|---------|------|------|
| Vite (PWA) | 5300 | 5173 is inside the WSL2-blocked 5144–5243 range |
| wrangler dev (backend) | 8787 | default |
| Supabase API / Postgres / Studio | 54321 / 54322 / 54323 | outside blocked range |

## Troubleshooting

- **401s in the browser**: backend `ANDROID_API_KEY` and `localStorage['expense_api_key']` must both be `e2e-test-key`.
- **Connection refused to :54321**: `supabase start` isn't running (Step 1).
- **Vite won't bind / page won't load**: another process on 5300, or you're inside the 5144–5243 blocked range — keep Vite on 5300.
- **Empty category picker**: `supabase db reset` wasn't run, or `seed.sql` wasn't generated from `categories.md`.
