# Implementation Plan: PWA Expense Tracker

**Branch**: `013-pwa-expense-tracker` | **Date**: 2026-05-19 | **Spec**: [spec.md](./spec.md)

## Summary

Build a mobile-first Progressive Web App that provides rich expense entry (cascading category picker, per-item tags, dynamic item rows), interactive spending charts with drill-down, and a transaction history view. The PWA authenticates with the existing API key and communicates with new `/pwa/*` routes added to the existing Cloudflare Worker. A new `categories` table drives the category picker without hardcoding. The Android app effort is suspended in favour of this approach.

## Technical Context

**Language/Version**: TypeScript 5.x (shared across frontend and backend)
**Primary Dependencies**:
- Frontend: React 18, Vite 5, Tailwind CSS 3, Recharts 2, TanStack Query 5, React Router 6
- Backend (additions): Hono (existing), new `/pwa/*` route handler alongside existing Discord/Android handlers
**Storage**: Supabase PostgreSQL (existing) + new `categories` table (migration 011)
**Testing**: Vitest (existing backend unit tests); React Testing Library + Playwright for PWA (added in a follow-up — not in scope for this feature's tasks)
**Target Platform**: Mobile browser PWA (390px+), deployed to Cloudflare Pages; backend on existing Cloudflare Worker
**Project Type**: Web application — new `pwa/` frontend project + backend extension
**Performance Goals**: Summary screen renders in < 3 s; expense submission round-trip < 2 s
**Constraints**: Mobile-first 390px layout; CF Worker CPU < 10 ms free-tier (CRUD routes); CSV import processed synchronously within a single Worker request (row cap: 1 000); no offline support in v1

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- [x] **I. Simplicity-First** — One new project component (`pwa/`) is added. Justified in Complexity Tracking: Discord cannot deliver the required UI, and Android Studio development is impractical from the WSL2 environment. No multi-user patterns, RBAC, or speculative abstractions introduced.
- [x] **II. Offline-First on Android** — Not applicable. The PWA is a browser app, not an Android app. No offline support is required in v1 (documented in spec assumptions).
- [x] **III. Serverless Boundary Compliance** — All new `/pwa/*` CRUD routes respond synchronously within CF Worker CPU limits. The CSV import endpoint reuses the existing `runImportPipeline` which is already time-bounded by a 1 000-row cap. No WebSocket or long-polling introduced.
- [x] **IV. Automation Over Manual Input** — The PWA improves the friction of manual expense entry; it does not replace or reduce automation. Discord commands and Android notification capture remain unchanged.
- [x] **V. Security at System Boundaries** — API key stored in `localStorage` at runtime (not in source code or config). All Supabase access remains server-side through the CF Worker. The same `androidAuth` middleware guards all `/pwa/*` routes. No new secrets introduced.

## Project Structure

### Documentation (this feature)

```text
specs/013-pwa-expense-tracker/
├── plan.md          ← this file
├── research.md      ← Phase 0 decisions
├── data-model.md    ← Phase 1 entities & migration
├── quickstart.md    ← Phase 1 dev setup
├── contracts/
│   └── api.md       ← /pwa/* endpoint contracts
└── tasks.md         ← Phase 2 output (/speckit-tasks)
```

### Source Code

```text
pwa/                              ← NEW: PWA frontend project
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── public/
│   └── manifest.json
└── src/
    ├── main.tsx
    ├── App.tsx                   ← bottom-nav router shell
    ├── api/
    │   └── client.ts             ← fetch wrapper with Bearer token + React Query setup
    ├── components/
    │   ├── CategoryPicker.tsx    ← major chips + subcategory row + bottom sheet
    │   ├── TagInput.tsx          ← free-tag autocomplete chip input
    │   ├── ItemRow.tsx           ← tag▼ | name | amount stepper row
    │   ├── BottomSheet.tsx       ← reusable slide-up overlay
    │   ├── PaymentPills.tsx
    │   └── ParentSearch.tsx      ← fee/refund parent transaction popup
    ├── screens/
    │   ├── EntryScreen.tsx       ← Expense / Fee / Refund tabs
    │   ├── SummaryScreen.tsx     ← chart + history + drilldown
    │   ├── BudgetScreen.tsx
    │   └── ImportScreen.tsx
    └── hooks/
        ├── useCategories.ts
        ├── useTags.ts
        └── useSummary.ts

backend/src/handlers/
└── pwa.ts                        ← NEW: all /pwa/* route handlers

backend/supabase/migrations/
└── 011_categories.sql            ← NEW: categories table + seed data + service_role grant
```

**Structure Decision**: Two-project layout (`pwa/` + existing `backend/`). The backend is extended with a new handler file only; no existing handler files are modified except `src/index.ts` (route registration). The frontend is a standalone Vite project deployed separately to Cloudflare Pages.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| New `pwa/` frontend project | Rich cascading category picker, interactive Recharts drill-down, and dynamic item builder cannot be expressed in Discord slash commands or modals | Android Studio is impractical from the WSL2 dev environment; a pure Discord UI cannot support the required interactions |

---

## Phase 0: Research

*See [research.md](./research.md) for full decision log.*

All key decisions resolved — no NEEDS CLARIFICATION items remain. Summary:

| Topic | Decision |
|-------|----------|
| Frontend bundler | Vite 5 + `@vitejs/plugin-react` |
| Styling | Tailwind CSS 3 (mobile-first, no component library) |
| Charts | Recharts 2 — `PieChart` (main) + `BarChart` (drilldown) |
| Server state | TanStack Query 5 (React Query) |
| Client routing | React Router 6 (hash-based for Pages) |
| PWA manifest | `vite-plugin-pwa` for manifest + icons; no service worker caching in v1 |
| Auth flow | `localStorage` key; cleared on 401; re-prompt on clear |
| CORS | CF Worker returns `Access-Control-Allow-Origin: <Pages domain>` for `/pwa/*` routes |
| CSV import in Worker | Synchronous within the request; 1 000-row cap keeps it within wall-clock limits |
| Bottom sheet | CSS transition + React portal — no library dependency |
| Category picker | Chips row (horizontal scroll) + `···` bottom sheet for overflow > 8 items |

---

## Phase 1: Design & Contracts

*See [data-model.md](./data-model.md) and [contracts/api.md](./contracts/api.md).*

### Key Design Decisions

**Category tag derivation**: `major` alone → tag key = `"major"` (e.g. `"食"`). `major` + `subcategory` → tag key = `"major:subcategory"` (e.g. `"食:早餐"`). This matches all existing Discord transaction tags exactly.

**Item tag inheritance**: When an item's tag is null/unset, the backend uses the transaction-level category tag when storing the item. The frontend shows the inherited tag dimmed.

**Parent search**: `GET /pwa/parent-search?q=<term>&days=90` — backend queries `transactions.note`, `transaction_items.name`, and `transactions.tags` using `ILIKE`. Adding `&days=all` removes the date filter.

**Drilldown state**: Managed client-side in `SummaryScreen` local state (no URL change needed for this single-user app).

**History grouping**: Backend returns raw transactions; frontend groups by UTC+8 day/week/month based on the selected window. No extra query needed.

**Import endpoint**: Accepts `multipart/form-data` with a `file` field. Decodes, parses, and runs `runImportPipeline` synchronously. Returns the same counters the Discord handler formats.
