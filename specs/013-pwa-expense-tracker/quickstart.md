# Quickstart: PWA Expense Tracker

**Branch**: `013-pwa-expense-tracker` | **Date**: 2026-05-19

---

## Prerequisites

- Node.js 20+ and pnpm (already used by `backend/`)
- Wrangler CLI (`pnpm -g add wrangler` or already installed)
- A running Supabase project with all migrations 001–010 applied
- `ANDROID_API_KEY` set as a Wrangler secret (already done if Discord/Android routes work)

---

## Step 1: Apply the categories migration

```bash
# From repo root — apply migration 011 to your Supabase project
# Via Supabase dashboard SQL editor, or using the supabase CLI:
psql "$SUPABASE_DB_URL" < backend/supabase/migrations/011_categories.sql
```

Verify: the `categories` table exists and has ~28 seed rows.

---

## Step 2: Add CORS origin to the Worker

The Worker needs to know the Pages origin to set the `Access-Control-Allow-Origin` header.

```bash
cd backend
wrangler secret put PWA_ORIGIN
# Enter: https://your-project.pages.dev  (or http://localhost:5173 for dev)
```

---

## Step 3: Deploy backend changes

```bash
cd backend
pnpm run deploy
```

Smoke-test the new route:
```bash
curl -H "Authorization: Bearer $ANDROID_API_KEY" \
     https://your-worker.workers.dev/pwa/categories
# Should return { "categories": [...] }
```

---

## Step 4: Install PWA dependencies

```bash
cd pwa && pnpm install
```

---

## Step 5: Configure the PWA for local dev

Create `pwa/.env.local`:
```
VITE_API_BASE=http://localhost:8787
```

For production (set in Cloudflare Pages env vars):
```
VITE_API_BASE=https://your-worker.workers.dev
```

The `VITE_API_BASE` value is used by `src/api/client.ts` as the base URL for all `/pwa/*` requests.

---

## Step 6: Run locally

Terminal 1 — backend dev server:
```bash
cd backend && pnpm run dev
# Starts wrangler dev on http://localhost:8787
```

Terminal 2 — PWA dev server:
```bash
cd pwa && pnpm run dev
# Starts Vite on http://localhost:5173
```

Open `http://localhost:5173` in your browser (or use Chrome DevTools → Toggle Device Toolbar for 390px mobile view).

On first load: enter your `ANDROID_API_KEY` value when prompted.

---

## Step 7: Deploy PWA to Cloudflare Pages

```bash
cd pwa
pnpm run build
# Outputs to pwa/dist/
```

In Cloudflare Dashboard → Pages → Create project → connect to Git (or direct upload `dist/`).

Build settings:
- Build command: `pnpm run build`
- Build output directory: `dist`
- Root directory: `pwa`

Set environment variable `VITE_API_BASE` to your Worker URL.

---

## Verifying the full flow

1. Open the Pages URL on your phone → add to Home Screen
2. Enter your API key when prompted
3. Log an expense: select 食 → 早餐, add items, submit → check Supabase `transactions` + `transaction_items` tables
4. Open Summary screen → verify pie chart matches the logged expense
5. Upload an e-invoice CSV via Import screen → verify result summary
