# Tasks: PWA Expense Tracker

**Input**: Design documents from `specs/013-pwa-expense-tracker/`
**Prerequisites**: plan.md ✓ | spec.md ✓ | research.md ✓ | data-model.md ✓ | contracts/api.md ✓

**Tests**: Not in scope for this feature — React Testing Library + Playwright deferred to a follow-up per plan.md.

**Organization**: Tasks grouped by user story. Each story is independently implementable and testable.

**Auth note**: US5 (First-Time Auth Setup, P5) is implemented in Phase 2 (Foundational) because it is a hard prerequisite for every other story. No separate US5 phase is needed.

**Backend file note**: All `/pwa/*` route handlers live in a single file (`backend/src/handlers/pwa.ts`). Handler tasks for different user story phases must be executed sequentially (no [P] across phases for this file).

## Format: `[ID] [P?] [Story?] Description — file path`

- **[P]**: Can run in parallel (different files, no pending dependencies)
- **[Story]**: Maps to user story in spec.md (US1–US6)

---

## Phase 1: Setup (Project Initialization)

**Purpose**: Bootstrap the `pwa/` frontend project and apply the database migration.

- [x] T001 Create `pwa/` directory and scaffold Vite React TS project: `pnpm create vite@latest pwa -- --template react-ts`
- [x] T002 Install all frontend dependencies in `pwa/`: `pnpm add recharts @tanstack/react-query react-router-dom && pnpm add -D tailwindcss @tailwindcss/vite vite-plugin-pwa`
- [x] T003 [P] Configure `pwa/vite.config.ts` — add `@vitejs/plugin-react`, `@tailwindcss/vite`, and `VitePWA` plugins; set PWA manifest fields (name: "Expense Tracker", display: standalone, theme_color, icons)
- [x] T004 [P] Configure `pwa/tailwind.config.ts` with content glob `["./index.html", "./src/**/*.{ts,tsx}"]`; add Tailwind directives to `pwa/src/index.css`
- [x] T005 [P] Apply `backend/supabase/migrations/011_categories.sql` to Supabase: `psql "$SUPABASE_DB_URL" < backend/supabase/migrations/011_categories.sql`; confirm ~28 seed rows exist in `categories`

**Checkpoint**: `pwa/` project boots (`pnpm dev`), migration applied.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend route infrastructure, frontend API client, auth prompt, and app shell. **Also satisfies US5** (First-Time Authentication Setup, P5).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T006 Create `backend/src/handlers/pwa.ts` — Hono sub-router instance; apply `androidAuth` middleware to all routes; add `OPTIONS /*` preflight handler returning CORS headers from `env.PWA_ORIGIN`
- [x] T007 Register pwa sub-router at `/pwa` prefix in `backend/src/index.ts` (`app.route('/pwa', pwaRouter)`); add Hono CORS middleware scoped to `/pwa/*` reading `env.PWA_ORIGIN`
- [x] T008 [P] Add `PWA_ORIGIN` to the `[vars]` section of `backend/wrangler.toml` (dev default: `http://localhost:5173`) and to `backend/worker-configuration.d.ts` Env interface
- [x] T009 Add `GET /pwa/categories` handler to `backend/src/handlers/pwa.ts` — `SELECT major, subcategory, sort_order FROM categories ORDER BY major ASC, sort_order ASC`; return `{ categories: Row[] }`
- [x] T010 Add `GET /pwa/tags` handler to `backend/src/handlers/pwa.ts` — unnest `transactions.tags`, exclude values containing `:`, return `{ tags: string[] }` sorted alphabetically
- [x] T011 [P] Create `pwa/src/api/client.ts` — typed `apiFetch(path, init?)` wrapper reading `import.meta.env.VITE_API_BASE` and Bearer token from `localStorage`; on 401 clears the stored key and throws `AuthError`; on other non-ok responses throws with parsed error body; export a shared `QueryClient` instance
- [x] T012 [P] Create `pwa/src/hooks/useAuth.ts` — exports `getApiKey`, `setApiKey`, `clearApiKey` localStorage helpers and `useApiKey` React state hook
- [x] T013 Create `pwa/src/components/ApiKeyPrompt.tsx` — full-screen centered form; on submit calls `GET /pwa/categories` (probe request) with the entered key; on 200 stores key via `setApiKey` and calls `onSuccess`; on 401 shows "Invalid API key" inline error; disables button while pending (depends on T011, T012)
- [x] T014 Create `pwa/src/App.tsx` — `QueryClientProvider` wrapper; `createHashRouter` with four routes (`/` → EntryScreen, `/summary` → SummaryScreen, `/budget` → BudgetScreen, `/import` → ImportScreen); bottom nav bar with four tab links; `AuthGuard` wrapper renders `ApiKeyPrompt` when no key is stored, then children after successful auth; `AuthError` from `apiFetch` clears key and forces re-render of prompt (depends on T011–T013)
- [x] T015 [P] Create `pwa/src/hooks/useCategories.ts` — TanStack Query for `GET /pwa/categories`; returns `{ majors: string[], subcategoriesFor(major): string[] }` derived from flat row array
- [x] T016 [P] Create `pwa/src/hooks/useTags.ts` — TanStack Query for `GET /pwa/tags`; returns `string[]`
- [x] T017 [P] Create `pwa/src/components/BottomSheet.tsx` — slide-up overlay via `ReactDOM.createPortal` to `document.body`; CSS `transform: translateY` transition with backdrop; accepts `open`, `onClose`, `title`, `children` props; backdrop tap calls `onClose`

**Checkpoint**: App loads, key prompt appears, valid key accepted, blank Entry screen shown. Categories and tags load from backend. Auth error clears key and shows prompt.

---

## Phase 3: User Story 1 — Log Expense with Items (Priority: P1) 🎯 MVP

**Goal**: User selects a category, adds free tags, enters a total, builds an item list with per-item tags and amounts, selects payment method, and submits an expense with linked items.

**Independent Test**: Submit a 3-item breakfast expense via the form; verify one `transactions` row and three `transaction_items` rows appear in Supabase with correct amounts and tags.

### Backend for US1

- [x] T018 Add `POST /pwa/expense` handler to `backend/src/handlers/pwa.ts` — validate `amount > 0`, `payment_method` enum, each non-null item amount > 0, sum of non-null item amounts ≤ total (return 400 `ITEMS_EXCEED_TOTAL`); assign tags per contract: `transactions.tags = free_tags`, each item's stored tags = `item.tag ?? category_tag ?? []`; call `insertTransaction` then `insertTransactionItems`; return 201 `{ id, amount, transaction_at }`

### Frontend for US1

- [x] T019 [P] [US1] Create `pwa/src/components/PaymentPills.tsx` — horizontal pill button group for `cash | credit_card | easy_card | prepaid_wallet | bank_account`; selected pill highlighted; accepts `value` and `onChange` props
- [x] T020 [P] [US1] Create `pwa/src/components/CategoryPicker.tsx` — horizontally scrollable major chip row from `useCategories`; selecting major reveals a subcategory chip row below it (also scrollable); when subcategory count > 8 a `···` chip appears that opens `BottomSheet` with full list and real-time search input; emits `{ major: string, subcategory: string | null } | null` via `onChange`
- [x] T021 [P] [US1] Create `pwa/src/components/TagInput.tsx` — text input with autocomplete dropdown from `useTags`; Enter or comma adds current value as chip; `×` removes chip; emits `string[]` via `onChange`
- [x] T022 [P] [US1] Create `pwa/src/components/ItemRow.tsx` — row with: (1) tag selector showing inherited category tag dimmed when null, tap opens dropdown to override per-row; (2) name text input; (3) amount stepper displaying `—` when null, first `+` sets to 1, `−` at 1 returns to null, manual blank = null; `×` remove button; accepts `item: ItemRow`, `inheritedTag: string | null`, `onChange`, `onRemove` props
- [x] T023 [US1] Create `pwa/src/screens/EntryScreen.tsx` Expense tab — amount input (large numeric), `PaymentPills`, `CategoryPicker`, `TagInput` for free tags, dynamic item list with Add Row button (each row is `ItemRow`), live total-match indicator (green = equal, amber = under, red = exceeds; submit blocked when red), Note collapsible text area; on submit call `POST /pwa/expense` via mutation; spinner during submission; success toast + form reset; preserve form data + show error on failure (depends on T018–T022)

**Checkpoint**: Full expense entry flow works end-to-end. Items visible in Supabase with correct category tags.

---

## Phase 4: User Story 2 — Spending Summary with Drill-Down (Priority: P2)

**Goal**: User views a pie chart by category for a time window, taps a slice to drill into subcategory bar charts, and browses grouped/collapsible transaction history.

**Independent Test**: Seed transactions across multiple categories; open Summary screen for 本月; verify pie proportions match totals; tap 食 slice; verify subcategory bar chart and filtered history appear.

### Backend for US2

- [x] T024 Add `GET /pwa/summary` handler to `backend/src/handlers/pwa.ts` — validate required `from`/`to` ISO date params; call existing `getCategoryTotals(supabase, from, to)`; compute percentage per category; return `{ grand_total, categories: [{ category, total, percentage }] }`
- [x] T025 Add `GET /pwa/summary/subcategories` handler to `backend/src/handlers/pwa.ts` — validate `from`, `to`, `major`; call existing `getSubcategoryTotals(supabase, from, to, major)`; return `{ major, total, subcategories: [{ subcategory, total, percentage }] }`
- [x] T026 Add `GET /pwa/transactions` handler to `backend/src/handlers/pwa.ts` — validate `from`/`to`; accept optional `category` (match transaction items where tag starts with category prefix), `page` (default 1), `limit` (default 50, max 200); JOIN `transaction_items` into nested array; return `{ total, page, transactions: [{ id, amount, transaction_type, payment_method, tags, note, transaction_at, items: [...] }] }`

### Frontend for US2

- [x] T027 [P] [US2] Create `pwa/src/hooks/useSummary.ts` — TanStack Query hooks: `useSummaryData({ from, to })`, `useSubcategoryData({ from, to, major })`, `useTransactions({ from, to, category? })`; expose a `windowToDates(window)` helper that returns `{ from, to }` ISO strings for each window option (UTC+8: 本月 = current calendar month, 上月 = previous month, 近3個月 = past 3 months, etc.)
- [x] T028 [P] [US2] Create `pwa/src/components/TimeWindowPicker.tsx` — segmented control for 本月/上月/近3個月/近半年/近一年/全部; emits selected window string via `onChange`; 本月 selected by default
- [x] T029 [US2] Create `pwa/src/screens/SummaryScreen.tsx` — `TimeWindowPicker` at top; Recharts `ResponsiveContainer > PieChart` with `Cell` colouring and `onClick` handler that sets `drilldownCategory` in local state; drilldown view: back arrow clears drilldown, Recharts horizontal `BarChart` for subcategory totals filtered to selected major; transaction history below charts grouped by day (window ≤ 3 months), ISO week (≤ 1 year), or month (all); all groups collapsed by default, tap group header to expand showing individual transactions with items; empty-state illustration when no data for window (depends on T024–T028)

**Checkpoint**: Summary screen renders for all time windows; pie drill-down, back navigation, and history expansion all work.

---

## Phase 5: User Story 3 — Fee & Refund Entry (Priority: P3)

**Goal**: User records a foreign transaction fee or refund, optionally linked to a parent expense found via real-time keyword search.

**Independent Test**: Create a parent expense; submit a fee linked to it via keyword search; verify fee transaction has correct `parent_transaction_id` in Supabase.

### Backend for US3

- [x] T030 Add `GET /pwa/parent-search` handler to `backend/src/handlers/pwa.ts` — require `q` param; accept `days` param (default 90, `"all"` removes date filter); `ILIKE '%' || q || '%'` against `transactions.note`, joined `transaction_items.name`, and `transactions.tags::text`; return top 5 by recency with `{ id, amount, note, transaction_at, item_names: string[] }`
- [x] T031 Add `POST /pwa/fee` handler to `backend/src/handlers/pwa.ts` — validate `amount > 0`, `description` present; call `insertTransaction({ transaction_type: 'fee', payment_method: 'credit_card', note: description })`; optionally call `updateParentTransactionId`; call `insertTransactionItems` with one item `{ name: description, amount, tags: [] }`; return 201 `{ id, amount, transaction_at }`
- [x] T032 Add `POST /pwa/refund` handler to `backend/src/handlers/pwa.ts` — same as fee but `transaction_type: 'refund'` and `payment_method` required from request body

### Frontend for US3

- [x] T033 [P] [US3] Create `pwa/src/components/ParentSearch.tsx` — text input fires `GET /pwa/parent-search?q=<term>&days=90` with 300 ms debounce; results rendered as popup list showing note/item names and amount; tap row to select (shows confirmation chip with amount); "Search older transactions" button appears when initial results empty (re-queries with `days=all`); clear button resets selection; emits `{ id, note, amount } | null` via `onSelect`
- [x] T034 [US3] Add Fee tab to `pwa/src/screens/EntryScreen.tsx` — amount input, description text input, `ParentSearch`; no PaymentPills (credit card fixed); submit via `POST /pwa/fee`; success toast + reset; preserve on error (depends on T030–T031, T033)
- [x] T035 [US3] Add Refund tab to `pwa/src/screens/EntryScreen.tsx` — same as Fee tab plus `PaymentPills`; submit via `POST /pwa/refund` (depends on T030, T032, T033)

**Checkpoint**: All three entry flows (Expense, Fee, Refund) work end-to-end including parent search and unlinked submission.

---

## Phase 6: User Story 4 — Import Invoice CSV (Priority: P4)

**Goal**: User uploads an e-invoice CSV and sees a result summary of matched, created, and skipped invoices.

**Independent Test**: Upload a valid CSV via the Import screen; verify result counts match expected values; upload a non-CSV file and verify the error message.

### Backend for US4

- [x] T036 Add `POST /pwa/import` handler to `backend/src/handlers/pwa.ts` — parse `multipart/form-data` `file` field; validate CSV headers (return 400 `INVALID_CSV`); count rows and return 400 `ROW_LIMIT_EXCEEDED` if > 1000; call `runImportPipeline`; return 200 `{ filename, matched_count, auto_created_count, skipped_duplicate_count, held_forex_count, ambiguous_count, skipped_voided_count, parse_failed_count }`

### Frontend for US4

- [x] T037 [P] [US4] Create `pwa/src/screens/ImportScreen.tsx` — file input (`accept=".csv"`); filename + file size preview after selection; Upload button triggers multipart `POST /pwa/import` mutation; spinner during upload; result summary table on success (matched / auto-created / skipped-duplicate / held-forex / skipped-voided counts); error banner for `INVALID_CSV` and `ROW_LIMIT_EXCEEDED` with description; reset button to clear state
- [x] T038 [US4] Verify Import screen is reachable via `/import` route and bottom nav tab in `pwa/src/App.tsx`

**Checkpoint**: CSV upload processes and returns result summary; invalid files and row-limit errors show correct messages.

---

## Phase 7: User Story 6 — Budget Progress Overview (Priority: P6)

**Goal**: User views current month spend versus monthly budget as a progress bar.

**Independent Test**: Open Budget screen; verify progress bar reflects current month spend and budget target from Supabase.

### Backend for US6

- [x] T039 Add `GET /pwa/budget` handler to `backend/src/handlers/pwa.ts` — call existing `getBudgetProgress(supabase)`; return `{ current_spend, monthly_budget, percentage }`

### Frontend for US6

- [x] T040 [US6] Create `pwa/src/screens/BudgetScreen.tsx` — TanStack Query for `GET /pwa/budget`; render filled progress bar (proportion = percentage / 100); label showing spend / budget amounts and percentage; when `percentage >= 100` apply over-budget visual state (red fill, warning indicator); loading skeleton while fetching

**Checkpoint**: Budget screen loads and reflects real Supabase data.

---

## Polish & Cross-Cutting Concerns

- [x] T041 [P] Create `pwa/.env.local` with `VITE_API_BASE=http://localhost:8787` and comment explaining production configuration via Cloudflare Pages env vars
- [x] T042 [P] Add `pwa/public/_redirects` with `/* /index.html 200` for Cloudflare Pages SPA fallback (hash router still benefits from this for direct URL opens)
- [x] T043 [P] Verify and update Cloudflare Pages build settings documented in `specs/013-pwa-expense-tracker/quickstart.md` (build command: `pnpm run build`, output: `dist`, root: `pwa`, env var: `VITE_API_BASE`)
- [x] T044 Run full quickstart.md validation: apply migration → start backend → start PWA → auth → log expense → view summary → import CSV → fix any gaps found

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Requires Phase 1 — **blocks all user story phases**
- **Phase 3–7 (User Stories)**: All depend on Phase 2; can proceed in priority order (recommended) or in parallel
- **Polish**: Depends on all desired stories complete

### User Story Dependencies

| Story | Depends on | Notes |
|-------|-----------|-------|
| US1 (P1) | Phase 2 | No story dependencies |
| US2 (P2) | Phase 2 | No story dependencies |
| US3 (P3) | Phase 2 | Reuses `PaymentPills` from US1 — implement US1 first or stub |
| US4 (P4) | Phase 2 | No story dependencies |
| US5 (Auth) | — | Implemented in Phase 2 (T012–T014) |
| US6 (P6) | Phase 2 | No story dependencies |

### Backend Handler Ordering in pwa.ts

All backend handlers are added sequentially to the same file:
```
Phase 2:  router + CORS + OPTIONS + GET /pwa/categories + GET /pwa/tags  (T006–T010)
Phase 3:  POST /pwa/expense                                                (T018)
Phase 4:  GET /pwa/summary, /subcategories, /transactions                  (T024–T026)
Phase 5:  GET /pwa/parent-search, POST /pwa/fee, POST /pwa/refund          (T030–T032)
Phase 6:  POST /pwa/import                                                  (T036)
Phase 7:  GET /pwa/budget                                                   (T039)
```

### Parallel Opportunities

**Phase 2** (start after T007):
```
Parallel: T008 (wrangler.toml), T011 (api/client.ts), T012 (useAuth.ts), T017 (BottomSheet.tsx)
Then:     T013 (ApiKeyPrompt — depends on T011, T012)
Then:     T014 (App.tsx — depends on T011–T013)
Parallel with T014: T015 (useCategories.ts), T016 (useTags.ts)
```

**Phase 3 (US1)** (start T018 backend first, then frontend in parallel):
```
Parallel: T019 (PaymentPills), T020 (CategoryPicker), T021 (TagInput), T022 (ItemRow)
Then:     T023 (EntryScreen Expense tab — depends on T018–T022)
```

**Phase 4 (US2)**:
```
Sequential backend: T024, T025, T026 (same file)
Parallel frontend:  T027 (useSummary.ts), T028 (TimeWindowPicker.tsx)
Then:               T029 (SummaryScreen — depends on T024–T028)
```

**Phase 5 (US3)**:
```
Sequential backend: T030, T031, T032 (same file)
Parallel frontend:  T033 (ParentSearch.tsx)
Then:               T034 (Fee tab — depends on T030–T031, T033)
Then:               T035 (Refund tab — depends on T030, T032, T033)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational → auth + app shell + categories/tags APIs
3. Phase 3: Expense entry → full item submission flow
4. **Stop and validate**: log breakfast expense on phone, confirm in Supabase

### Incremental Delivery

| After completing | What works |
|-----------------|------------|
| Phase 2 | Auth prompt, app shell, blank screens |
| Phase 3 (US1) | Full expense entry — daily driver ⭐ MVP |
| Phase 4 (US2) | Spending charts + drill-down + history |
| Phase 5 (US3) | Fee & refund entry with parent search |
| Phase 6 (US4) | CSV import in PWA |
| Phase 7 (US6) | Budget progress overview |
| Polish | Deployment-ready |

---

## Task Count Summary

| Phase | Tasks | Parallelisable |
|-------|-------|----------------|
| Phase 1: Setup | 5 (T001–T005) | 3 |
| Phase 2: Foundational (incl. US5) | 12 (T006–T017) | 6 |
| Phase 3: US1 Expense | 6 (T018–T023) | 4 |
| Phase 4: US2 Summary | 6 (T024–T029) | 3 |
| Phase 5: US3 Fee/Refund | 6 (T030–T035) | 2 |
| Phase 6: US4 Import | 3 (T036–T038) | 1 |
| Phase 7: US6 Budget | 2 (T039–T040) | 0 |
| Polish | 4 (T041–T044) | 3 |
| **Total** | **44** | **22** |
