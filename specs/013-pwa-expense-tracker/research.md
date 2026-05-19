# Research: PWA Expense Tracker

**Branch**: `013-pwa-expense-tracker` | **Date**: 2026-05-19

All decisions below were resolved from first principles and existing project context. No external research queries were required.

---

## Decision 1: Frontend Bundler

**Decision**: Vite 5 with `@vitejs/plugin-react`

**Rationale**: Vite is already used by the backend (Vitest). Fast HMR, minimal config, first-class TypeScript support, and Cloudflare Pages deploys any `dist/` output directly. No eject step.

**Alternatives considered**: Create React App (deprecated), Next.js (SSR not needed for a single-user client-only app — adds unnecessary complexity).

---

## Decision 2: Styling

**Decision**: Tailwind CSS 3, no component library

**Rationale**: Mobile-first utility classes enable compact, custom layouts without a component library's opinionated design system. Constitution principle I (Simplicity-First) discourages adding component libraries that bring their own theming, build steps, and JS. All UI components are custom but small.

**Alternatives considered**: shadcn/ui (adds Radix, heavier), Chakra UI (CSS-in-JS, performance concern on mobile), plain CSS modules (verbose for utility patterns).

---

## Decision 3: Charts

**Decision**: Recharts 2 — `PieChart` for category summary, `BarChart` (horizontal) for subcategory drilldown

**Rationale**: React-native, TypeScript-typed, responsive container support, touch-friendly click handlers. Pie slice click directly triggers drilldown state. Already chosen by the user.

**Alternatives considered**: Chart.js (imperative API, needs wrapper for React), Victory (heavier), D3 (too low-level for this scope).

---

## Decision 4: Server State

**Decision**: TanStack Query 5 (React Query)

**Rationale**: Eliminates manual loading/error state management for all `/pwa/*` API calls. Automatic background refetch, cache invalidation after mutations, and optimistic updates for submit actions. Minimal boilerplate for a small number of query keys.

**Alternatives considered**: SWR (fewer features, no mutations), raw `useEffect` + `useState` (acceptable but verbose across 8+ endpoints), Zustand (good for client state, not server-caching).

---

## Decision 5: Client Routing

**Decision**: React Router 6, hash-based (`createHashRouter`)

**Rationale**: Cloudflare Pages serves a SPA — hash routing avoids 404s on deep-link refreshes without needing `_redirects` configuration. Three top-level routes (entry / summary / budget) plus a nested import route under settings.

**Alternatives considered**: HTML5 history routing with `_redirects` file (works but adds config). TanStack Router (overkill for 4 routes).

---

## Decision 6: PWA Manifest

**Decision**: `vite-plugin-pwa` for web app manifest + icons; service worker caching disabled in v1

**Rationale**: The manifest is required for "Add to Home Screen" on Chrome/Safari. The plugin generates it from config with zero extra code. Service worker is omitted in v1 per spec assumption (network connection assumed).

**Alternatives considered**: Hand-written `manifest.json` in `public/` (simpler but misses icon generation). Full Workbox caching (out of scope for v1).

---

## Decision 7: Authentication Flow

**Decision**: On first load, show a full-screen key prompt. Store key in `localStorage`. Attach as `Authorization: Bearer <key>` on every request. On any 401 response, clear the key and redirect to the key prompt.

**Rationale**: Single-user personal tool. The key is equivalent to a password. `localStorage` is the appropriate browser-side store for persistent non-session credentials. Not in source code, not in config files — compliant with Constitution Principle V.

**Alternatives considered**: `sessionStorage` (clears on tab close — would require re-entry every session, too friction-heavy). Cookie-based (requires CORS credentials config, more complex). Supabase Auth (overkill, adds a signup/email flow the user doesn't need).

---

## Decision 8: CORS

**Decision**: CF Worker returns `Access-Control-Allow-Origin: https://<pages-domain>` for all `/pwa/*` routes. A `OPTIONS` preflight handler is added.

**Rationale**: The frontend (Cloudflare Pages) and backend (Cloudflare Worker) are on different origins. Hono has a built-in CORS middleware that handles this with one line.

**Alternatives considered**: Proxy via Pages Functions (adds another layer, unnecessary complexity).

---

## Decision 9: CSV Import in CF Worker

**Decision**: Process the CSV synchronously within the HTTP request. Return the result summary in the response body.

**Rationale**: The existing `runImportPipeline` already caps at 1 000 rows. Typical imports are < 200 rows and complete in well under 30 seconds. Unlike Discord (which needs a deferred response due to the 3-second interaction timeout), a plain HTTP POST can wait for the full result. No `waitUntil()` needed.

**Alternatives considered**: Background processing with a job ID and polling (complex, no clear need at this scale). Streaming response (Hono supports it, but the client just needs a final summary).

---

## Decision 10: Bottom Sheet

**Decision**: CSS `transform: translateY` transition + React `createPortal` to `document.body`. No library.

**Rationale**: The only bottom sheet usage is the overflow category picker. A simple slide-up div with a backdrop is 30 lines of CSS/TSX. Adding `react-spring` or `framer-motion` for one animation violates Constitution I.

---

## Decision 11: Category Picker Layout

**Decision**: Major categories as a horizontal scrollable chip row (always visible). Tapping a major chip expands a second chip row below it for subcategories (same horizontal scroll pattern). When a major category has more than 8 subcategories, a `···` chip appears at the end of the subcategory row; tapping it opens the bottom sheet with the full list and a search input.

**Rationale**: Keeps the most common subcategories one tap away. The 8-item threshold is chosen to fit ~2 screens worth of chips before overflow. The bottom sheet search handles long-tail subcategories without cluttering the main form.

---

## Decision 12: Item Amount Stepper

**Decision**: The amount field displays `—` when null/unset. Tapping `+` sets it to 1. Tapping `−` at 1 returns to null (not 0). Manual keyboard entry is also supported (blank = null, non-zero integer required). Amount 0 is rejected.

**Rationale**: Matches the existing backend behaviour — `transaction_items.amount` is `INTEGER NULL`. The `insertTransactionItems` function rejects amounts ≤ 0. Null means "unallocated remainder", which is valid.
