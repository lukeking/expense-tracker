# Tasks: Category Tags & Trend Charts

**Feature**: `005-category-trends` | **Branch**: `005-category-trends`
**Input**: Design documents from `specs/005-category-trends/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no unresolved dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Based on plan.md: `backend/src/` for source; `backend/tests/services/` for unit tests.

---

## Phase 1: Setup (Shared Type Foundation)

**Purpose**: Add shared TypeScript types referenced across all stories.

- [X] T001 Add `SummaryPeriod` union type and `CategoryTotal`, `SubcategoryTotal` interfaces to `backend/src/types.ts`

---

## Phase 2: Foundational (Blocking Prerequisites for US2 and US3)

**Purpose**: Database query layer needed by both the summary and drill-down handlers.

**Note**: US1 (expense parser) does NOT depend on this phase — it can proceed in parallel with Phase 2 after T001.

- [X] T002 Implement `getTransactionsForPeriod(start: Date, end: Date)` in `backend/src/db/queries.ts` — Supabase select of `id, amount, tags, transaction_at` filtered by `transaction_type = 'expense'` and `transaction_at >= start AND transaction_at < end`, ordered by `transaction_at`

**Checkpoint**: DB query ready — US2 and US3 implementation can proceed.

---

## Phase 3: User Story 1 — Hierarchical Expense Tagging (Priority: P1) 🎯 MVP

**Goal**: Replace Gemini-based `/expense` description parsing with a deterministic comma-delimited token parser that classifies category tags, payment methods, line items, and notes — including mismatch and duplicate-category warnings.

**Independent Test**: Issue `/expense` commands from quickstart.md scenarios 1–3. Verify stored transaction fields (payment_method, tags, items, note) and response warnings match the contract examples in `contracts/expense-parser.md`. No US2/US3 changes required.

### Tests (defined in plan.md project structure)

> Write these first and confirm they fail before T004 is implemented.

- [X] T003 [P] [US1] Write unit tests covering all `parseDescription()` contract examples (contracts/expense-parser.md examples table + FR-005 duplicate-category + FR-006 mismatch cases) in `backend/tests/services/expense-parser.test.ts`

### Implementation

- [X] T004 [P] [US1] Create `parseDescription(description: string, totalAmount: number): ParsedDescription` in `backend/src/services/expense-parser.ts` — split description on `,`, trim each token, classify per priority order: (1) starts with `#` and contains `:` → categoryTag (first occurrence only; emit duplicate warning on subsequent ones); (2) starts with `#`, no `:` → plainTags; (3) exact case-insensitive match to payment keyword enum → paymentMethod; (4) last whitespace-separated word is numeric → line item; (5) everything else → note fragment; after classification emit mismatch warning when sum(items) ≠ totalAmount
- [X] T005 [P] [US1] Update Gemini prompt rules in `backend/src/services/gemini.ts` — add explicit rule that freeform text tokens without a trailing numeric word MUST NOT be extracted as line items (FR-007), ensuring the Android path `parseRawExpenseText` aligns with the new deterministic rules
- [X] T006 [US1] Refactor `/expense` handler in `backend/src/handlers/discord.ts` — call `parseDescription()` instead of Gemini for the Discord command path, build transaction from `ParsedDescription` fields (`categoryTag`, `plainTags`, `items`, `note`, `paymentMethod`), append all `warnings[]` entries to the confirmation message

**Checkpoint**: US1 fully functional. Validate with quickstart.md scenarios 1–3.

---

## Phase 4: User Story 2 — Category Spending Summary Chart (Priority: P2)

**Goal**: `/summary period:<value>` returns a deferred Discord response containing a QuickChart.io pie chart of top-level category spending, a formatted text table, and up to 5 drill-down buttons.

**Independent Test**: Seed transactions with known category tags across a date range. Run `/summary period:month` and `/summary period:all`. Verify chart image and text table reflect correct totals, buttons appear for each category (max 5), and empty-period returns `此期間無支出記錄`. Validate quickstart.md scenarios 4, 6, 7, 8.

### Tests (defined in plan.md project structure)

> Write these first and confirm they fail before T009/T010 are implemented.

- [X] T007 [P] [US2] Write unit tests for `periodToDateRange()` and `aggregateByCategory()` in `backend/tests/services/summary.test.ts` — cover all 6 period values, `其他` grouping for no-colon and no-tag transactions, >5 categories (top-5 by amount cap), and empty transaction set
- [X] T008 [P] [US2] Write unit tests for `fetchPieChartUrl()` and `fetchBarChartUrl()` in `backend/tests/services/chart.test.ts` — mock global fetch to verify correct Chart.js JSON payload POSTed to `https://quickchart.io/chart/create`, verify returns `null` (not throws) on non-200 response or fetch failure

### Implementation

- [X] T009 [P] [US2] Create `backend/src/services/summary.ts` with: `periodToDateRange(period: SummaryPeriod): { start: Date; end: Date }` per contracts/summary-command.md period table (`all` → `new Date(0)` to now); `aggregateByCategory(transactions): CategoryTotal[]` sorted desc by total, grouping no-colon/no-tag transactions under `其他`, capping at 5 (remainder merged into `其他`); `aggregateBySubcategory(transactions, category: string): SubcategoryTotal[]` using `split(':').slice(1).join(':')` for subcategory, `其他` for plain tags; `formatCategoryTable(totals: CategoryTotal[]): string` markdown table with NT$ amounts and percentage column
- [X] T010 [P] [US2] Create `backend/src/services/chart.ts` with: `fetchPieChartUrl(totals: CategoryTotal[]): Promise<string | null>` and `fetchBarChartUrl(totals: SubcategoryTotal[], category: string): Promise<string | null>` — POST Chart.js config to `https://quickchart.io/chart/create` per contracts/summary-command.md chart specs, return `url` from response JSON, return `null` (do not throw) on non-200 or network error
- [X] T011 [P] [US2] Add `period` STRING option with 6 choices (`month`, `last-month`, `3months`, `half-year`, `year`, `all`) to `/summary` command definition object in `backend/src/handlers/discord.ts`
- [X] T012 [US2] Implement `/summary` command handler in `backend/src/handlers/discord.ts` — respond type:5 immediately, then inside `ctx.waitUntil()`: call `getTransactionsForPeriod` with date range from `periodToDateRange`, call `aggregateByCategory`, call `fetchPieChartUrl`, PATCH followup with embed (chart image if URL non-null), `formatCategoryTable` output, and ActionRow with up-to-5 buttons using `custom_id: summary_drilldown:{b64cat}:{period}` where `b64cat = btoa(category)`; if no transactions return text `此期間無支出記錄` without chart

**Checkpoint**: US2 fully functional. Validate with quickstart.md scenarios 4, 6, 7, 8.

---

## Phase 5: User Story 3 — Category Drill-Down Chart (Priority: P3)

**Goal**: Tapping a category button on the `/summary` response triggers a deferred bar chart showing spending per subcategory for that category and the same time period.

**Independent Test**: After a `/summary period:month` response, tap the `食` button. Verify bar chart shows correct subcategory totals and text table matches. Also verify: single-subcategory → single bar, plain-tag-only category → single `其他` bar, chart failure → text-only table. Validate quickstart.md scenario 5.

### Implementation

- [X] T013 [US3] Implement drilldown button interaction handler in `backend/src/handlers/discord.ts` — match `custom_id` starting with `summary_drilldown:`, split on `:` to extract `b64cat` (index 1) and `period` (index 2), decode category via `Buffer.from(b64cat, 'base64').toString('utf-8')`, call `getTransactionsForPeriod` using `periodToDateRange(period)`, filter transactions to those whose category tag matches, call `aggregateBySubcategory`, call `fetchBarChartUrl`, PATCH with deferred response containing embed (if chart URL non-null) + subcategory text table + `💰 小計：NT$X`; if no transactions return `此分類在此期間無支出記錄`; chart failure falls back to text-only table

**Checkpoint**: All three user stories functional. Run full quickstart.md validation (scenarios 1–8).

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Discord command registration and end-to-end validation.

- [X] T014 [P] Re-register `/summary` command with Discord API to publish the updated command definition with the new `period` option (run existing registration script or POST updated command payload to Discord application commands endpoint)
- [X] T015 Run all 8 quickstart.md scenarios against the deployed CF Worker, confirm expected responses for each, and log any deviations

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — blocks US2 and US3 only
- **US1 (Phase 3)**: Depends on Phase 1 only — runs in parallel with Phase 2
- **US2 (Phase 4)**: Depends on Phase 1 + Phase 2 (T002)
- **US3 (Phase 5)**: Depends on Phase 4 (T009, T010, T012)
- **Polish (Phase 6)**: Depends on all desired stories complete

### User Story Dependencies

- **US1 (P1)**: Depends only on T001 — start immediately after Phase 1; no dependency on Phase 2
- **US2 (P2)**: Depends on T001 + T002 — start after Phase 2 completes
- **US3 (P3)**: Depends on T009 + T010 + T012 — start after Phase 4 completes

### Within Each User Story

- **US1**: T003 [P], T004 [P], T005 [P] can all run in parallel (different files); T006 depends on T004
- **US2**: T007, T008, T009, T010, T011 can all run in parallel (different files); T012 depends on T009 + T010 + T011
- **US3**: T013 depends on T009 + T010 + T012

---

## Parallel Example: User Story 2

```bash
# All of these can launch simultaneously (different files):
Task: "T007 — backend/tests/services/summary.test.ts"
Task: "T008 — backend/tests/services/chart.test.ts"
Task: "T009 — backend/src/services/summary.ts"
Task: "T010 — backend/src/services/chart.ts"
Task: "T011 — /summary command definition in discord.ts"

# Then sequentially:
Task: "T012 — /summary handler in discord.ts (depends on T009, T010, T011)"
```

---

## Parallel Example: User Story 1

```bash
# All of these can launch simultaneously (different files):
Task: "T003 — backend/tests/services/expense-parser.test.ts"
Task: "T004 — backend/src/services/expense-parser.ts"
Task: "T005 — backend/src/services/gemini.ts (prompt rule update)"

# Then sequentially:
Task: "T006 — /expense handler refactor in discord.ts (depends on T004)"
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: T001
2. Complete Phase 3: T003 + T004 + T005 (parallel) → T006
3. **STOP and VALIDATE**: quickstart.md scenarios 1–3
4. Deploy — cleaner expense entry with sum validation and category tags starts accumulating data

### Incremental Delivery

1. Setup + US1 → Deploy (categorised expense data begins accumulating)
2. Foundational + US2 → Deploy (spending overview charts live)
3. US3 → Deploy (drill-down subcategory insights)

### Parallel Strategy (split work)

After T001 completes:
- **Thread A**: T002 → T007 + T008 + T009 + T010 + T011 (parallel) → T012 → T013
- **Thread B**: T003 + T004 + T005 (parallel) → T006

Both threads converge at Phase 6 (T014 + T015).

---

## Notes

- [P] tasks touch different files with no blocking dependencies — safe to parallelize
- [Story] label maps each task to its user story for traceability
- US1 and Phase 2 can run fully in parallel after T001 — key throughput opportunity
- The Gemini path (`parseRawExpenseText` for Android) is unchanged; only the Discord `/expense` path is refactored (T006)
- QuickChart.io failure must be silent to the user — always include text table; chart embed is additive
- `aggregateBySubcategory` handles the `其他` case (plain tag or no category tag) per FR-014
- Base64-encode category names in button `custom_id` to safely handle CJK within the 100-char limit
