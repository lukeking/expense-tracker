# Tasks: E-Invoice CSV Import + /amend

**Input**: Design documents from `specs/004-einvoice-csv-import/`
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅

**Organization**: Tasks follow the plan's A→F phase order. `/amend` (Phase A) ships first per user direction. Each subsequent phase maps to a user story and is independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase
- **[Story]**: Maps to user story in spec.md (US1=Enrich Existing, US2=Discover Missed, US3=Import Summary, US4=Periodic Reminder)

---

## Phase 1: Setup

**Purpose**: Install new dependency, extend Discord types, prepare command registration skeleton.

- [x] T001 Install `big5` npm package: `cd backend && pnpm add big5` and verify it appears in `package.json`
- [x] T002 Extend `DiscordInteraction` interface in `backend/src/handlers/discord.ts` to add `data.resolved.attachments` field per `contracts/discord-commands.md` shape (needed by both /amend and /import handlers)

---

## Phase 2: Foundational — DB Migration + Types

**Purpose**: Schema changes and TypeScript types that ALL subsequent phases depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete and the migration is applied to Supabase.

- [x] T003 Write migration `backend/supabase/migrations/004_einvoice_import.sql` exactly as specified in `data-model.md` — `import_runs` table, `invoices` table (with generated `net_amount` column and `uq_invoice_number` constraint), and `ALTER TABLE transactions` to add `invoice_number`, `seller_name`, `seller_tax_id`, `matched_invoice_id` columns
- [x] T004 Apply `004_einvoice_import.sql` to Supabase (run via Supabase dashboard SQL editor or CLI); verify all three operations succeed without error
- [x] T005 Add new TypeScript types to `backend/src/types.ts`: `InvoiceMatchStatus`, `InvoiceItem`, `Invoice`, `ImportRun`, `RawInvoiceRow`, `ParsedInvoice` as defined in `data-model.md`

**Checkpoint**: Migration applied, types compiled. All subsequent phases can begin.

---

## Phase 3: /amend — Discord E2E (Ship First)

**Goal**: A user can correct an existing transaction's NTD amount via `/amend` in Discord, with candidate-list UX and retype modal when no match found.

**Independent Test**: Record a transaction, run `/amend amount:1523 parent:<keyword>`, select the candidate button, verify the transaction amount in the DB is updated and the Discord message shows the old → new amount change.

- [x] T006 Add `amendTransactionAmount(supabase, txId: string, newAmount: number): Promise<void>` to `backend/src/db/queries.ts`; it runs `UPDATE transactions SET amount = $1 WHERE id = $2`
- [x] T007 Add `/amend` command definition to `backend/scripts/register-commands.ts` — options: `amount` (INTEGER, required, min 1), `parent` (STRING, optional) — see `contracts/discord-commands.md`
- [x] T008 Add `/amend` command handler in `backend/src/handlers/discord.ts`: return `type:5` deferred immediately; in `ctx.waitUntil` call `findParentCandidates(parent)` and patch with candidate buttons (custom_id `amend_select:{amount}:{txId}`) or "not found" message with `amend_retype:{amount}` and `amend_cancel` buttons
- [x] T009 Add `amend_select` component handler in `backend/src/handlers/discord.ts`: parse `newAmount` and `txId` from `custom_id`; call `amendTransactionAmount`; return `type:7` UPDATE_MESSAGE showing `✅ 已修正：{description} NT${oldAmount} → NT${newAmount}` with `components: []`; include budget summary line (reuse existing `getMonthlySpend`)
- [x] T010 Add `amend_retype` component handler in `backend/src/handlers/discord.ts`: return `type:9` MODAL with `custom_id: amend_modal:{amount}`, single text input `search_term`
- [x] T011 Add `amend_modal` submit handler in `backend/src/handlers/discord.ts`: return `type:6` DEFERRED_UPDATE_MESSAGE; in `ctx.waitUntil` re-run `findParentCandidates(searchTerm)` and patch with buttons or "not found" + retype again
- [x] T012 Add `amend_cancel` component handler in `backend/src/handlers/discord.ts`: return `type:7` UPDATE_MESSAGE with content `已取消。` and `components: []`
- [x] T013 Register `/amend` with Discord: run `pnpm tsx scripts/register-commands.ts` and confirm command appears in Discord (allow up to 1 hour propagation)
- [x] T014 [P] Add tests for `/amend` flow in `backend/tests/handlers/discord.test.ts`: (a) type:5 response on /amend invocation, (b) `amend_select` custom_id encoding/decoding, (c) `amendTransactionAmount` called with correct args on button select, (d) type:7 UPDATE_MESSAGE with components:[] after selection, (e) type:9 MODAL returned for amend_retype, (f) type:6 DEFERRED_UPDATE_MESSAGE for modal submit
- [x] T015 [P] Add `amendTransactionAmount` unit test in `backend/tests/db/queries.test.ts`: verify amount updated, other fields unchanged

**Checkpoint**: `/amend` fully functional in Discord. Forex correction workflow is unblocked.

---

## Phase 4: US1 — Upload CSV and Enrich Existing Transactions (Priority: P1)

**Goal**: User uploads government e-invoice CSV via `/import`; system parses it, matches invoices to existing transactions by exact amount ±2 days, enriches matched transactions, and deduplicates on re-upload.

**Independent Test**: Create 5 expense transactions; import a CSV with matching invoices (same amounts ±2 days); verify all 5 transactions have `is_matched=true`, `invoice_number`, `seller_name`, `seller_tax_id` populated; re-import same CSV; verify 0 new records.

- [x] T016 [P] Write `backend/src/services/csv-parser.ts` with: `decodeCSVBuffer(buffer: ArrayBuffer): string` (UTF-8 strict → `big5` fallback), `parseROCDate(raw: string): Date` (adds 1911 to ROC year), `validateHeaders(headers: string[]): boolean` (checks expected government CSV columns), `parseCSVRows(csv: string): RawInvoiceRow[]` (tolerates malformed rows, skips with count), `groupInvoices(rows: RawInvoiceRow[]): ParsedInvoice[]` (groups by `發票號碼`, aggregates line items, filters voided and zero-net-amount rows)
- [x] T017 [P] Add primary-match DB queries to `backend/src/db/queries.ts`: `createImportRun(supabase, fileName: string): Promise<ImportRun>`, `updateImportRun(supabase, runId: string, counters: Partial<ImportRun>): Promise<void>`, `findExistingInvoiceNumbers(supabase, numbers: string[]): Promise<string[]>` (returns already-seen invoice numbers), `findMatchingExpenseTransaction(supabase, netAmount: number, invoiceDate: Date): Promise<Transaction | null>` (expense type, exact amount, ±2 days), `insertInvoice(supabase, invoice: ParsedInvoice, importRunId: string, matchStatus: InvoiceMatchStatus, matchedTxId?: string): Promise<Invoice>`, `enrichTransaction(supabase, txId: string, fields: { invoiceNumber: string; sellerName: string; sellerTaxId: string; invoiceId: string }): Promise<void>` (sets `is_matched=true`, populates new columns)
- [x] T018 Write `backend/src/services/invoice-matcher.ts` with `runPrimaryMatchPass(supabase, invoices: ParsedInvoice[], importRunId: string): Promise<{ matched: number; unmatched: ParsedInvoice[] }>` — for each invoice: check dedup → skip voided/zero → find exact-match transaction → enrich transaction + insert invoice as `matched`; increment import_run counters
- [x] T019 Add `/import` command definition to `backend/scripts/register-commands.ts` — single `file` option (type 11, required) — see `contracts/discord-commands.md`
- [x] T020 Add `/import` command handler in `backend/src/handlers/discord.ts`: return `type:5` deferred; in `ctx.waitUntil`: extract attachment URL from `interaction.data.resolved.attachments`, fetch CSV bytes, call csv-parser, create import_run, call `runPrimaryMatchPass`, patch Discord with partial summary
- [x] T021 Register `/import` with Discord: run `pnpm tsx scripts/register-commands.ts`
- [x] T022 [P] Write `backend/tests/services/csv-parser.test.ts`: (a) UTF-8 decode, (b) Big5 fallback, (c) ROC date conversion (114/04/18 → 2025-04-18), (d) multi-row grouping by invoice number, (e) voided row filtered out, (f) zero-amount row filtered out, (g) malformed row skipped with count incremented, (h) wrong headers returns validation error

**Checkpoint**: `/import` accepts CSV, matches existing transactions, deduplicates. US1 independently testable.

---

## Phase 5: US2 — Discover Missed Transactions (Priority: P1)

**Goal**: Invoices with no matching transaction auto-create new expense records; forex near-matches are flagged as held; post-import reconciliation resolves held invoices when amounts are corrected.

**Independent Test**: Import CSV with 3 invoices that have no existing transactions; verify 3 new expense records created with `payment_method=cash`, `transaction_type=expense`, AI-inferred tags; verify re-importing creates 0 duplicates.

- [x] T023 Add `findForexCandidateTransaction(supabase, netAmount: number, invoiceDate: Date): Promise<Transaction | null>` to `backend/src/db/queries.ts` — expense type, amount within ±5% of netAmount, date within ±2 days; returns closest match or null
- [x] T024 Add `findAllHeldForexInvoices(supabase): Promise<Invoice[]>` and `resolveHeldInvoice(supabase, invoiceId: string, txId: string, matchStatus: 'matched' | 'auto_created'): Promise<void>` to `backend/src/db/queries.ts`
- [x] T025 Extend `backend/src/services/invoice-matcher.ts` with `runSecondaryForexPass(supabase, unmatched: ParsedInvoice[], importRunId: string): Promise<{ held: number; stillUnmatched: ParsedInvoice[] }>` — for each remaining unmatched invoice: call `findForexCandidateTransaction` → insert invoice as `held_forex` if found; collect truly unmatched for auto-create step
- [x] T026 Extend `backend/src/services/invoice-matcher.ts` with `runAutoCreate(supabase, unmatched: ParsedInvoice[], importRunId: string, gemini: GeminiService): Promise<number>` — for each truly unmatched invoice: call Gemini for tag inference, INSERT new expense transaction (`cash`, `transaction_type=expense`, `is_matched=true`, AI tags), INSERT invoice as `auto_created` with `matched_transaction_id`
- [x] T027 Extend `backend/src/services/invoice-matcher.ts` with `runReconciliationPass(supabase, gemini: GeminiService): Promise<number>` — load all `held_forex` invoices from DB; for each: call `findMatchingExpenseTransaction` (exact) → if found set `matched`; else call `findForexCandidateTransaction` (still ±5%) → keep `held_forex`; else call `runAutoCreate` → set `auto_created`; return count resolved
- [x] T028 Wire secondary pass, auto-create, and reconciliation pass into the `/import` handler pipeline in `backend/src/handlers/discord.ts` (`ctx.waitUntil`); update import_run counters with all phase results
- [x] T029 [P] Write `backend/tests/services/invoice-matcher.test.ts`: (a) primary exact match found → transaction enriched, (b) forex ±5% match → invoice marked held_forex, (c) no match → new transaction created with cash+tags, (d) dedup: second import of same invoice_number skipped, (e) reconciliation pass: held invoice resolves after amount corrected to exact match, (f) reconciliation pass: held invoice auto-creates when no candidate found at all
- [x] T030 [P] Extend `backend/tests/db/queries.test.ts` with: `findMatchingExpenseTransaction` (exact match, ±2 days boundary conditions), `findForexCandidateTransaction` (±5% boundary), `findExistingInvoiceNumbers` (dedup check), `enrichTransaction` (all columns updated)

**Checkpoint**: Full import pipeline operational — match, hold, auto-create, reconcile. US2 independently testable.

---

## Phase 6: US3 — Import Summary and Spending Audit (Priority: P2)

**Goal**: After import, bot replies with structured counts and lists any transactions in the CSV date range that still have no invoice.

**Independent Test**: Import CSV covering 30 days with 8 invoices (5 matched, 2 auto-created, 1 held forex); verify summary shows exact counts; verify 3 existing transactions in that period listed as "no invoice found".

- [x] T031 Add `findTransactionsWithoutInvoiceInRange(supabase, from: Date, to: Date): Promise<Transaction[]>` to `backend/src/db/queries.ts` — expense-type transactions in date range where `matched_invoice_id IS NULL`, ordered by `transaction_at DESC`
- [x] T032 Write `formatImportSummary(run: ImportRun, unmatchedTxs: Transaction[]): string` in `backend/src/handlers/discord.ts` (or a small helper at the bottom of the file) — formats the Discord message per `contracts/discord-commands.md` summary template; handles "全部對齊" case when no unmatched txs
- [x] T033 Wire `findTransactionsWithoutInvoiceInRange` and `formatImportSummary` into the `/import` handler's final patch step; derive date range from min/max `invoice_date` in the processed invoices
- [x] T034 [P] Add summary formatting unit tests in `backend/tests/handlers/discord.test.ts`: (a) all counts present in output, (b) "全部對齊" shown when unmatchedTxs is empty, (c) `forex_resolved_count > 0` shows reconciliation line, (d) more than 5 unmatched txs shows truncation with "+ N 筆"

**Checkpoint**: Import summary fully formatted. US3 independently testable.

---

## Phase 7: US4 — Periodic Download Reminder (Priority: P3)

**Goal**: Bot sends a Discord reminder every 2 months prompting the user to download and upload their CSV, noting the last import date.

**Independent Test**: Configure cron; verify Discord message is sent at scheduled time containing a reminder with the date of the last import run.

- [x] T035 Add cron schedule to `backend/wrangler.toml`: `{ crons = ["0 9 1 */2 *"] }` (9am UTC on 1st of every other month)
- [x] T036 Add cron handler in `backend/src/index.ts` `scheduled()` export: query `import_runs` ORDER BY `uploaded_at DESC LIMIT 1`; send Discord message to `DISCORD_CHANNEL_ID` via `patchInteractionMessage` (or direct channel message POST) with reminder text including last import date; if no import runs exist, omit last-import reference
- [x] T037 [P] Add cron handler test in `backend/tests/handlers/discord.test.ts`: (a) reminder message includes last import date when runs exist, (b) reminder message omits last-import line when no runs exist

**Checkpoint**: Periodic reminder operational. All four user stories complete.

---

## Phase 8: Polish & Validation

**Purpose**: Smoke-test the full flow end-to-end using quickstart.md, confirm no regressions.

- [x] T038 Run full test suite: `cd backend && pnpm test` — all tests pass
- [x] T039 Execute `quickstart.md` Phase 1 smoke tests for `/amend` (happy path, retype, cancel) against deployed CF Worker
- [x] T040 Execute `quickstart.md` Phase 2 smoke tests for `/import` (basic import, re-import idempotency, forex → amend → reconcile workflow) against deployed CF Worker
- [x] T041 [P] Update `specs/003-discord-fee-refund/quickstart.md` if any existing commands are affected by schema changes (verify `/fee`, `/refund`, `/expense`, `/summary` still work correctly post-migration)

---

## Phase 9: Spec Amendment — FR-005 Ambiguous Match + FR-014 Batch Limit

**Purpose**: Implement spec changes from `/speckit-clarify` session 2026-05-09. Two behaviour corrections: (1) ambiguous invoices (multiple same-amount candidates on same day) must be held without linking rather than auto-matched; (2) hard 1,000-row import limit with batch-of-100 processing. Also closes two test gaps from `/speckit-analyze` (E1, E3).

**Prerequisite**: All T001–T041 must be complete (Phase 9 amends existing logic).

- [x] T042 Write `backend/supabase/migrations/005_add_ambiguous_count.sql` — `ALTER TABLE import_runs ADD COLUMN ambiguous_count integer NOT NULL DEFAULT 0`; apply to Supabase via dashboard or CLI; verify column present
- [x] T043 Update `backend/src/types.ts` — add `'ambiguous'` to `InvoiceMatchStatus` union; add `ambiguous_count: number` field to `ImportRun` type
- [x] T044 Update `findMatchingExpenseTransaction` in `backend/src/db/queries.ts` — change return type from `Promise<Transaction | null>` to `Promise<Transaction[]>`; remove `LIMIT 1` from query so all matching expense transactions within ±2 days / exact amount are returned
- [x] T045 Update `runPrimaryMatchPass` in `backend/src/services/invoice-matcher.ts` — consume `Transaction[]` from T044; if `candidates.length > 1` → insert invoice as `ambiguous`, increment `import_run.ambiguous_count`, leave all candidate transactions unenriched; if `candidates.length === 1` → existing exact-match logic; if `candidates.length === 0` → pass to unmatched list as before
- [x] T046 Update `formatImportSummary` in `backend/src/handlers/discord.ts` — when `run.ambiguous_count > 0` add an `⚠️ 模糊配對 (N 筆)` section listing each ambiguous invoice as `• {賣方名稱} NT${amount} — 候選：{tx1.description} / {tx2.description} …`; omit section entirely when count is 0
- [x] T047 Update `parseCSVRows` (or end of `groupInvoices`) in `backend/src/services/csv-parser.ts` — after grouping, if `invoices.length > 1000` throw a structured `RowLimitError({ actual: number })` before returning; import is rejected before any DB operations
- [x] T048 Update `/import` handler in `backend/src/handlers/discord.ts` — inside `ctx.waitUntil` catch `RowLimitError` and patch Discord with: `"CSV 包含 {N} 筆發票，超過單次上限 1,000 筆。請依日期區間分批上傳。"` (no partial processing)
- [x] T049 Update `runImportPipeline` in `backend/src/services/invoice-matcher.ts` — wrap the primary match pass loop in `chunk(invoices, 100)` slices so DB operations stay within CF Workers 30s wall time for large (≤1,000-row) imports
- [x] T050 [P] Add test to `backend/tests/services/invoice-matcher.test.ts` — given two expense transactions with identical amount on same date, import one invoice matching both → invoice status is `ambiguous`, `ambiguous_count === 1`, both transactions have `is_matched = false`
- [x] T051 [P] Add test to `backend/tests/handlers/discord.test.ts` — `formatImportSummary` with `ambiguous_count > 0` includes seller name and both candidate descriptions; `ambiguous_count === 0` omits the ambiguous section entirely
- [x] T052 [P] Add test to `backend/tests/services/csv-parser.test.ts` — CSV with 1,001 grouped invoices throws `RowLimitError`; CSV with exactly 1,000 grouped invoices returns array without error
- [x] T053 [P] Add test to `backend/tests/services/csv-parser.test.ts` — CSV containing a voided invoice and a valid replacement for the same purchase (same 發票號碼 prefix, differing 發票狀態) → only the valid invoice in output; voided counted in skipped, not matched or auto-created
- [x] T054 Run full test suite `cd backend && pnpm test` — all T050–T053 tests pass alongside existing suite; no regressions

**Checkpoint**: Ambiguous invoices are now held safely; large CSVs fail fast with a clear user message; test suite is green.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (DB Migration)**: Requires Phase 1 (types depend on migration schema) — **BLOCKS all story phases**
- **Phase 3 (/amend)**: Requires Phase 2 — independent of US1–US4
- **Phase 4 (US1)**: Requires Phase 2 (migration + types)
- **Phase 5 (US2)**: Requires Phase 4 (primary match pass must exist before secondary/auto-create)
- **Phase 6 (US3)**: Requires Phase 5 (needs complete import run counters)
- **Phase 7 (US4)**: Requires Phase 2 (needs import_runs table) — independent of US1–US3
- **Phase 8 (Polish)**: Requires all prior phases
- **Phase 9 (Amendment)**: Requires Phase 8 — amends existing logic from T016, T017, T018, T025, T032, T034

### Within Each Phase

- [P]-marked tasks within a phase have no interdependency and can run concurrently
- Non-[P] tasks within a phase run sequentially in listed order

### Parallel Opportunities

```bash
# Phase 4 — start these together:
T016  # csv-parser.ts
T017  # primary-match DB queries

# Phase 5 — start these together after T025-T028 complete:
T029  # invoice-matcher tests
T030  # DB query tests

# Phase 3 — start these together after T011:
T014  # discord handler tests
T015  # amendTransactionAmount DB test

# Phase 9 — start these together after T045-T047 complete:
T050  # invoice-matcher: ambiguous match test
T051  # discord: formatImportSummary ambiguous section test
T052  # csv-parser: row-limit rejection test
T053  # csv-parser: voided+valid co-existence test
```

---

## Implementation Strategy

### Ship /amend first (Phases 1–3)

1. Complete Phase 1: Setup (T001–T002)
2. Complete Phase 2: DB migration (T003–T005)
3. Complete Phase 3: /amend Discord e2e (T006–T015)
4. **STOP and VALIDATE**: Smoke-test `/amend` in Discord
5. Deploy — forex correction is now unblocked

### Incremental CSV import delivery

1. Phase 4 (US1) → deploy → basic import + matching works
2. Phase 5 (US2) → deploy → auto-create + forex hold + reconciliation works
3. Phase 6 (US3) → deploy → full structured summary with spending audit
4. Phase 7 (US4) → deploy → periodic reminder active

---

## Notes

- Total tasks: **55** | Completed: **55** (T001-T054) | Pending: none
- Tasks per story: Phase 3 (/amend) = 10, US1 = 7, US2 = 8, US3 = 4, US4 = 3, Polish = 4, Setup/Foundation = 5, Amendment = 13
- [P] tasks = different files, no mutual dependency within phase
- Commit after each checkpoint or logical group (T006, T013, T021, T028, T033, T037)
- ROC calendar conversion (T016) is a silent data bug if skipped — all date windows will be off by 1911 years
- `big5` package (T001) must be installed before csv-parser.ts compiles
- Migration (T004) must be applied before any import handler can write to DB
