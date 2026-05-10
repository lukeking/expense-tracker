# Tasks: Category Tags & Trend Charts

**Input**: Design documents from `specs/005-category-trends/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Organization**: Tasks are grouped by user story. US1 (expense parser) is fully independent. US2 (summary chart) and US3 (drill-down) share the `getTransactionsForPeriod` DB query and `periodToDateRange` helper but are each independently testable. No DB migration — all categorisation is derived at read time from the existing `tags text[]` column.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase (different files)
- **[Story]**: Maps to user story in spec.md (US1=Expense Tagging, US2=Summary Chart, US3=Drill-Down)

---

## Phase 1: Setup

**Purpose**: Add the shared `SummaryPeriod` type consumed by US2 and US3. No DB migration required for this feature.

- [x] T001 Add `SummaryPeriod` type to `backend/src/types.ts`: `export type SummaryPeriod = 'month' | 'last-month' | '3months' | 'half-year' | 'year' | 'all';`

---

## Phase 2: US1 — Hierarchical Expense Tagging (Priority: P1) 🎯 MVP

**Goal**: A single `/expense` command records payment method, `category:subcategory` tag, merchant note, and line items from a comma-separated description. Sum mismatch triggers a warning in the confirmation message. Gemini is replaced by a deterministic parser on the Discord path.

**Independent Test**: Issue `/expense amount:300 description:信用卡, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50`; verify stored transaction has `payment_method=credit_card`, `tags=['食:午餐']`, `note='麥當勞'`, `items=[{大麥克套餐,250},{蘋果派,50}]`, and no warning. Issue same command with `amount:350`; verify mismatch warning appears in Discord reply.

- [x] T002 [P] [US1] Write `backend/src/services/expense-parser.ts` exporting `ParsedDescription` interface (`paymentMethod`, `categoryTag`, `plainTags`, `items`, `note`, `warnings`) and `parseDescription(description: string, totalAmount: number): ParsedDescription` implementing the 5-rule token classification pipeline per `contracts/expense-parser.md`: (1) `#tag:sub` → categoryTag (first only); (2) `#tag` → plainTags; (3) exact payment keyword match → paymentMethod; (4) last whitespace-separated word numeric → line item; (5) remaining → note
- [x] T003 [P] [US1] Update `COMMON_PROMPT_RULES` in `backend/src/services/gemini.ts` to add explicit rule: freeform text tokens without `#` and without a trailing number must NOT be created as line items (Android notification path clarification per research.md Decision 5)
- [x] T004 [US1] Update `/expense` handler in `backend/src/handlers/discord.ts` to call `parseDescription(description, amount)` instead of Gemini for the Discord path; map `ParsedDescription` fields to the transaction insert (`payment_method`, `tags` = `[categoryTag, ...plainTags].filter(Boolean)`, `note`, `items`); append any `warnings` lines to the confirmation message
- [x] T005 [P] [US1] Write `backend/tests/services/expense-parser.test.ts`: (a) credit_card + categoryTag + note + two items → no warning (250+50=300), (b) sum mismatch → warning string includes NT$ totals, (c) easy_card + route note + categoryTag + no items, (d) plain `#tag` without colon → plainTags, categoryTag null, (e) two `#cat:sub` tokens → first used + multiple-category warning, (f) payment keyword matching case-insensitive (`Cash` → cash), (g) trailing-number token → line item, not note, (h) freeform text without trailing number → note not item, (i) empty string input → all null/empty fields

**Checkpoint**: `/expense` deterministic parsing fully functional. Gemini removed from Discord hot path. US1 independently testable.

---

## Phase 3: US2 — Category Spending Summary Chart (Priority: P2)

**Goal**: `/summary period:month` returns a deferred response with a QuickChart.io pie chart image, per-category NT$ breakdown table, percentage, and up to 5 drill-down buttons. Graceful degradation: empty period → text message; chart failure → text-only table.

**Independent Test**: Seed 3 transactions with tags `食:午餐`, `行:捷運`, and no tag; run `/summary period:month`; verify Discord reply contains pie chart embed, table showing 食/行/其他 totals, and two category buttons. Re-run with no transactions in period; verify text-only "此期間無支出記錄".

- [x] T006 [P] [US2] Add `getTransactionsForPeriod(supabase, from: Date, to: Date): Promise<Transaction[]>` to `backend/src/db/queries.ts` — selects `id, amount, tags, transaction_at` for `transaction_type = 'expense'` where `transaction_at >= from AND transaction_at < to`, ordered by `transaction_at DESC`
- [x] T007 [P] [US2] Write `backend/src/services/summary.ts` exporting `CategoryTotal` and `SubcategoryTotal` interfaces and: `periodToDateRange(period: SummaryPeriod): { from: Date; to: Date }` (per date-range table in `contracts/summary-command.md`; `all` → `new Date(0)` to now); `aggregateByCategory(transactions: Transaction[]): CategoryTotal[]` (derives category via `tags.find(t => t.includes(':'))?.split(':')[0] ?? '其他'`, sums amounts, sorts desc); `aggregateBySubcategory(transactions: Transaction[], category: string): SubcategoryTotal[]` (filters to matching category, derives subcategory via `split(':').slice(1).join(':') || '其他'`, sums amounts, sorts desc)
- [x] T008 [P] [US2] Write `backend/src/services/chart.ts` exporting `fetchPieChartUrl(totals: CategoryTotal[]): Promise<string | null>` and `fetchBarChartUrl(totals: SubcategoryTotal[], category: string): Promise<string | null>` — each POSTs to `https://quickchart.io/chart` with Chart.js JSON per chart specs in `contracts/summary-command.md` (pie) and `contracts/drilldown-button.md` (horizontal bar); returns the `url` string from the response JSON; returns `null` on any non-200 or network failure (no error thrown)
- [x] T009 [US2] Add `/summary` command definition to `backend/scripts/register-commands.ts` — add `period` STRING option with 6 choices (`month`/`last-month`/`3months`/`half-year`/`year`/`all`, required: false) per `contracts/summary-command.md`; replace any existing `/summary` definition
- [x] T010 [US2] Add `/summary` handler in `backend/src/handlers/discord.ts`: return type:5 deferred; in `ctx.waitUntil`: read `period` option (default `'month'`), call `periodToDateRange`, call `getTransactionsForPeriod`; if empty → PATCH text-only `此期間無支出記錄`; call `aggregateByCategory`, call `fetchPieChartUrl` (null → omit embed, still send table); PATCH with embed image (if URL obtained) + category table (分類 · NT$ · %) + 總計 line + up to 5 `summary_drilldown:{btoa(category)}:{period}` buttons per `contracts/summary-command.md`
- [x] T011 [P] [US2] Write `backend/tests/services/summary.test.ts`: (a) `periodToDateRange` returns correct from/to for all 6 period values including `all` (from = epoch), (b) `aggregateByCategory` correctly groups transactions by first-colon split and sums amounts, (c) no-tag transactions grouped as 其他, (d) >5 categories → top 5 each get entry, remainder merged into 其他 slice, (e) single-category input → one entry, (f) empty transaction list → [], (g) `aggregateBySubcategory` scopes to matching category only and uses post-colon portion
- [x] T012 [P] [US2] Write `backend/tests/services/chart.test.ts`: (a) `fetchPieChartUrl` returns URL string on 200 with `{ url }` body, (b) returns null on non-200 status, (c) returns null when fetch throws, (d) `fetchBarChartUrl` returns URL on success, (e) returns null on failure; (f) POST body sent to quickchart.io has correct `type: 'pie'` / `type: 'bar'` and non-empty `data.labels`

**Checkpoint**: `/summary` functional with pie chart, table, and drill-down buttons. US2 independently testable.

---

## Phase 4: US3 — Category Drill-Down Chart (Priority: P3)

**Goal**: Tapping a category button returns a bar chart of subcategory spending for the same period. Stateless — category and period are decoded from the button's `custom_id`.

**Independent Test**: Trigger a `summary_drilldown:6aWt:month` component interaction (食, month); verify Discord PATCH contains bar chart embed and subcategory table showing subcategory totals under 食. Trigger with a category that has no subcategories; verify single bar labelled 其他.

- [x] T013 [US3] Add `summary_drilldown` component handler in `backend/src/handlers/discord.ts` (match `custom_id.startsWith('summary_drilldown:')`): return type:5 deferred; in `ctx.waitUntil`: split `custom_id` on `:` — `[, b64cat, period]` — decode category via `Buffer.from(b64cat, 'base64').toString('utf-8')`, call `periodToDateRange(period as SummaryPeriod)`, call `getTransactionsForPeriod`, call `aggregateBySubcategory(txs, category)`; if empty → PATCH text-only `此分類在此期間無支出記錄`; call `fetchBarChartUrl` (null → text-only table), PATCH with bar chart embed + subcategory table + `💰 小計` per `contracts/drilldown-button.md`
- [x] T014 [P] [US3] Add `summary_drilldown` handler tests in `backend/tests/handlers/discord.test.ts`: (a) type:5 response returned on `summary_drilldown:` button, (b) base64 category decoded correctly (`6aWt` → 食), (c) PATCH body contains subcategory table rows matching aggregation result, (d) when category has only plain tags (no colon) → subcategory shown as 其他, (e) empty result for category → text-only 此分類在此期間無支出記錄 PATCH

**Checkpoint**: Full category workflow complete — tag entry → summary chart → drill-down. All three user stories operational.

---

## Phase 5: Polish & Validation

**Purpose**: Register commands, run full test suite, smoke-test all quickstart scenarios.

- [x] T015 Register `/summary` with Discord: `cd backend && pnpm tsx scripts/register-commands.ts` and confirm `/summary` appears with `period` choices in Discord (allow up to 1 hour propagation)
- [x] T016 Run full test suite: `cd backend && pnpm test` — all tests pass (including new expense-parser, chart, summary, and discord drilldown tests)
- [ ] T017 Execute quickstart.md scenarios 1–8 against deployed CF Worker: (1) categorised expense, (2) sum mismatch, (3) plain tag, (4) monthly summary, (5) drill-down, (6) all-time summary, (7) empty period, (8) chart failure graceful degradation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US1)**: Requires Phase 1 (SummaryPeriod type not needed for US1; can actually start alongside Phase 1)
- **Phase 3 (US2)**: Requires Phase 1 (SummaryPeriod) — independent of US1 (parser not needed for summary)
- **Phase 4 (US3)**: Requires Phase 3 (needs `periodToDateRange`, `getTransactionsForPeriod`, `aggregateBySubcategory`, `fetchBarChartUrl`)
- **Phase 5 (Polish)**: Requires all prior phases

### Within Each Phase

- [P]-marked tasks touch different files — no mutual dependency; can run concurrently
- Non-[P] tasks run sequentially (T004 depends on T002; T010 depends on T006+T007+T008+T009)

### Parallel Opportunities

```bash
# Phase 2 — start together:
T002  # expense-parser.ts (new file)
T003  # gemini.ts prompt update (different file)
T005  # expense-parser.test.ts (new file)
# T004 runs after T002 completes

# Phase 3 — start together:
T006  # queries.ts: getTransactionsForPeriod
T007  # summary.ts: aggregation + period helpers
T008  # chart.ts: QuickChart.io wrapper
T011  # summary.test.ts
T012  # chart.test.ts
# T009 and T010 run after T006+T007+T008 complete
```

---

## Implementation Strategy

### Ship US1 first (Phases 1–2)

1. Complete Phase 1: Type addition (T001)
2. Complete Phase 2: Deterministic parser + discord.ts update + gemini.ts update (T002–T005)
3. **STOP and VALIDATE**: Test `/expense` with new format in Discord
4. Deploy — cleaner expense entry immediately available

### Incremental chart delivery

1. Phase 3 (US2) → deploy → `/summary` with pie chart + buttons
2. Phase 4 (US3) → deploy → drill-down bar chart
3. Phase 5 → full smoke test

---

## Notes

- Total tasks: **17** | Completed: **0** | Pending: T001-T017
- Tasks per phase: Setup=1, US1=4, US2=7, US3=2, Polish=3
- [P] tasks: T002, T003, T005, T006, T007, T008, T011, T012, T014 (9 of 17)
- No DB migration — categories derived at read time from existing `tags text[]` column
- `Buffer.from(b64cat, 'base64')` works in CF Workers (nodejs_compat flag already set in wrangler.toml)
- QuickChart.io failure must always fall back to text table — never surface an error to the user (research.md Decision 2)
- `aggregateByCategory` caps at 5 button categories — remainder merged into 其他 slice (FR-012); the pie chart still shows all slices but only 5 get buttons
- Commit after each checkpoint (T004, T010, T013, T016)
