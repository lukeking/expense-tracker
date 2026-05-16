# Tasks: Legacy Accounting Data Migration

**Input**: Design documents from `specs/010-migrate-legacy/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/cli.md ✅

**Tests**: Not requested — no test tasks generated.

**Organization**: Tasks grouped by user story to enable independent implementation and validation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on sibling tasks)
- **[Story]**: Which user story this task belongs to
- All paths are relative to the repo root

---

## Phase 1: Setup

**Purpose**: Schema change, type update, and file scaffolding. No user story work begins until T004 is done.

- [x] T001 Write migration `backend/supabase/migrations/008_add_source_to_transactions.sql` — `ALTER TABLE transactions ADD COLUMN source TEXT` + sparse index on non-null source values
- [x] T002 [P] Add `source?: string` to the `Transaction` interface in `backend/src/types.ts`
- [x] T003 [P] Add `dry-run-*.txt` to `backend/.gitignore` (or root `.gitignore`) so preview files are never committed
- [x] T004 [P] Create `backend/src/services/legacy-csv-parser.ts` with the `ParsedLegacyRow` interface (fields: `transaction_at`, `transaction_type`, `amount`, `note`, `items`, `tags`, `payment_method`, `source`, `is_matched`, `_dedup_key`, `_raw_line`) and module stub

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core CSV reading and shared parsing primitives used by every user story. Must be complete before any US phase.

**⚠️ CRITICAL**: No user story implementation can begin until T010 is complete.

- [x] T005 Implement CSV row reader in `backend/src/services/legacy-csv-parser.ts` — parse the 11-column NaggingMoney header, return an async iterable of raw string arrays; validate column count per row; throw on missing file
- [x] T006 [P] Implement date parser in `backend/src/services/legacy-csv-parser.ts` — convert `YYYY-MM-DD HH:MM:SS` to ISO 8601 with `+08:00` timezone offset; skip row on malformed date
- [x] T007 [P] Implement amount parser in `backend/src/services/legacy-csv-parser.ts` — strip `NT`/`NT$` prefix, parse to integer; flag non-TWD rows (add to `_non_twd` counter); skip row on parse failure
- [x] T008 Implement row type classifier in `backend/src/services/legacy-csv-parser.ts` — `99` → skip (increment skipped counter); `支出` → `'expense'`; `收入` → `'refund'`; unknown → skip with warning
- [x] T009 Implement dedup key builder in `backend/src/services/legacy-csv-parser.ts` — produce `${amount}|${transaction_at}|${note}` string as `_dedup_key` on each `ParsedLegacyRow`
- [x] T010 Implement dedup set loader in `backend/scripts/migrate-legacy.ts` — before first batch write, query `SELECT amount, transaction_at, note FROM transactions WHERE source = 'legacy_migration'`, build `Set<string>` of dedup keys; log count found

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 — Core Import Pipeline (Priority: P1) 🎯 MVP

**Goal**: All ~15,200 expense rows and 6 income rows are imported into Supabase in batches of 100, with deduplication on re-run and an accurate terminal summary.

**Independent Test**: Run script against full CSV. Verify row counts in DB match source CSV (accounting for type-99 skips). Verify re-run produces zero new inserts and shows correct deduplicated count. Verify sum of imported amounts matches sum of `金額` column.

- [x] T011 [US1] Implement CLI argument parser in `backend/scripts/migrate-legacy.ts` — accept positional `<csv-path>` (required), `--dry-run` flag (boolean), `--batch-size <n>` (integer, default 100); exit with code 1 and usage message if csv-path is missing
- [x] T012 [US1] Implement batch insert loop in `backend/scripts/migrate-legacy.ts` — iterate parsed rows, check dedup set, accumulate into batches of `--batch-size`, call `supabase.from('transactions').insert(batch)` per batch, update dedup set after each successful insert
- [x] T013 [US1] Implement per-row write failure handling in `backend/scripts/migrate-legacy.ts` — on Supabase error for a row, skip it, increment `failed` counter, log the row number and error message; do not abort the batch or the script
- [x] T014 [US1] Implement terminal summary in `backend/scripts/migrate-legacy.ts` — after all batches complete, print: total rows read, skipped (type-99), imported (expense), imported (income/refund), deduplicated, parse failures, non-TWD flagged

**Checkpoint**: `npx tsx scripts/migrate-legacy.ts ../NaggingMoney_20260516082424_utf8.csv` runs to completion with correct summary counts.

---

## Phase 4: User Story 2 — Category & Field Mapping (Priority: P1)

**Goal**: All 9 NaggingMoney categories produce correct `category:subcategory` tags; `)` subcategory separator is parsed; `備註` content is appended as a plain tag; transaction description lands in both `note` and `items[0].name`.

**Independent Test**: Run script against a hand-curated 20-row CSV covering all 9 categories and several `)` patterns. Verify each record has the correct tag, note, and items value. Verify a row with `食` + `飲料)紅茶拿鐵` produces tag `"食:飲料"`, note `"紅茶拿鐵"`, items `[{name:"飲料)紅茶拿鐵", amount}]`. Verify `備註 = "美式套餐"` produces an additional plain tag `"美式套餐"`.

- [x] T015 [P] [US2] Implement category mapping config in `backend/src/services/legacy-csv-parser.ts` — a typed constant mapping all 9 category codes (食, 行, 他, 店, 醫, 住, 衣, 樂, 育) to their tag prefix strings; return `'其他'` prefix and increment unmapped counter for any unrecognised value
- [x] T016 [P] [US2] Implement `)` separator parser in `backend/src/services/legacy-csv-parser.ts` — split `項目` on first `)`: left side → subcategory, right side (trimmed) → description text; if no `)`, entire `項目` → both subcategory and description text
- [x] T017 [US2] Implement `category:subcategory` tag builder in `backend/src/services/legacy-csv-parser.ts` — combine category prefix (from T015) and subcategory (from T016) as `"${prefix}:${subcategory}"`; populate `tags[0]` with this value
- [x] T018 [US2] Implement `note` and `items` population in `backend/src/services/legacy-csv-parser.ts` — `note` = description text from T016; `items` = `[{name: full_項目_text, amount: row_amount}]` (full original item text, not split)
- [x] T019 [US2] Implement `備註` → plain tag mapping in `backend/src/services/legacy-csv-parser.ts` — if `備註` cell is non-empty, append its trimmed value to `tags[]` as a plain string (no `:` prefix); empty `備註` adds nothing

**Checkpoint**: Hand-curated 20-row test CSV validates correctly. Run full dry-run and review category coverage table — all 9 categories should appear with zero unmapped.

---

## Phase 5: User Story 3 — Payment Method Inference (Priority: P2)

**Goal**: `支出帳戶` / `收入帳戶` field values are mapped to the correct `payment_method`; unknown values default to `cash` with a logged warning.

**Independent Test**: Import a sample with `支出帳戶 = 現金` rows and rows with an empty account field. Verify `現金` rows have `payment_method = 'cash'` and empty rows also have `payment_method = 'cash'`. Run a dry-run preview and confirm the warning count for unrecognised account values is zero against the real CSV.

- [x] T020 [P] [US3] Implement payment method mapping table in `backend/src/services/legacy-csv-parser.ts` — map `現金` → `cash`, `信用卡` → `credit_card`, `悠遊卡` → `easy_card`, `銀行` → `bank_account`, empty string → `cash`; any unrecognised value → `cash` + increment `unmapped_account` warning counter
- [x] T021 [US3] Apply payment method mapping in the row parser in `backend/src/services/legacy-csv-parser.ts` — for `支出` rows read `支出帳戶`; for `收入` rows read `收入帳戶`; call mapping from T020; include unrecognised values in terminal summary warning line

**Checkpoint**: Spot-check 20 records in DB — all have `payment_method = 'cash'` (the dominant value in the source CSV for empty account rows).

---

## Phase 6: User Story 4 — Dry Run Preview (Priority: P2)

**Goal**: `--dry-run` writes a full preview to a timestamped file, makes zero DB writes, and prints a one-line summary to the terminal. Each dry-run produces a distinct file.

**Independent Test**: Run `--dry-run` against the full CSV. Verify zero new records in DB. Verify a `dry-run-YYYYMMDD-HHMMSS.txt` file is created containing category coverage, sample rows, and "Would insert" count. Run dry-run a second time; verify a second distinct file exists and the first is unchanged.

- [x] T022 [US4] Gate all Supabase writes behind `!isDryRun` check in `backend/scripts/migrate-legacy.ts` — when `--dry-run` is set, the batch insert call (T012) and dedup-set loader query (T010) are both skipped; all parsing and mapping still runs
- [x] T023 [US4] Implement timestamped preview file writer in `backend/scripts/migrate-legacy.ts` — generate filename `dry-run-YYYYMMDD-HHMMSS.txt` using local time; write: header line, source filename, row count breakdown, category coverage table (category → row count), unmapped account values (if any), 10-row sample table (line│date│type│amount│tags│note│payment_method), "Would insert: N" footer
- [x] T024 [US4] Implement dry-run terminal output in `backend/scripts/migrate-legacy.ts` — suppress all batch progress lines; print only: `[migrate-legacy] Dry run complete — see <filename>`
- [x] T025 [US4] Confirm no-overwrite behaviour in `backend/scripts/migrate-legacy.ts` — timestamp is captured once at script start and used for the filename; a second invocation within the same second would produce a collision only in theory (sub-second precision via `Date.now()` suffix is sufficient)

**Checkpoint**: `npx tsx scripts/migrate-legacy.ts --dry-run ../NaggingMoney_20260516082424_utf8.csv` → file created, DB unchanged, terminal shows one-line summary.

---

## Phase 7: Polish & Validation

**Purpose**: End-to-end validation against real data before committing the import.

- [ ] T026 [P] Apply migration `008_add_source_to_transactions.sql` to the production Supabase instance and confirm `source` column appears on `transactions`
- [ ] T027 Run full dry-run against `NaggingMoney_20260516082424_utf8.csv` per `quickstart.md` Step 2; review preview file and confirm: all 9 categories covered, zero unmapped, sample rows look correct, "Would insert ≈ 15,203"
- [ ] T028 Run full import (non-dry-run) per `quickstart.md` Step 3; confirm terminal summary shows `Imported ≈ 15,197`, `Income (refund): 6`, `Deduplicated: 0`, `Parse failures: 0`
- [ ] T029 Run `/summary all` in Discord and verify historical category totals appear; confirm no unexpected `其他` spike from unmapped categories
- [ ] T030 Run the migration script a second time and verify `Deduplicated: 15,203`, `Imported: 0` — confirming re-run safety (SC-003)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — T001–T004 can start immediately; T002–T004 are parallel
- **Phase 2 (Foundational)**: Requires Phase 1 complete — blocks all user story phases
- **Phase 3 (US1)**: Requires Phase 2 complete
- **Phase 4 (US2)**: Requires Phase 2 complete; T015 and T016 are parallel with each other; T017–T019 depend on T015 + T016
- **Phase 5 (US3)**: Requires Phase 2 complete; T020 and T021 are independent of US2 (different mapper function)
- **Phase 6 (US4)**: Requires Phase 3 complete (dry-run wraps the same import pipeline)
- **Phase 7 (Polish)**: Requires all prior phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2). MVP deliverable.
- **US2 (P1)**: Depends on Foundational (Phase 2). T015 and T016 can run in parallel with US1 tasks.
- **US3 (P2)**: Depends on Foundational (Phase 2). Fully independent of US1/US2 in implementation.
- **US4 (P2)**: Depends on US1 (wraps the same insert loop with a dry-run gate).

### Within Each Phase

- T015 and T016 (US2) can run in parallel — they write to different functions in the same file
- T020 (US3) can run in parallel with all US2 tasks — separate mapping function
- T022 (US4) must come after T012 (US1 batch loop exists to gate)

---

## Parallel Example: Phase 4 (US2)

```bash
# T015 and T016 have no dependency on each other — start together:
Task: "Implement category mapping config in legacy-csv-parser.ts"
Task: "Implement ) separator parser in legacy-csv-parser.ts"

# Once both complete, T017-T019 follow sequentially:
Task: "Implement category:subcategory tag builder"
Task: "Implement note and items population"
Task: "Implement 備註 → plain tag mapping"
```

---

## Implementation Strategy

### MVP First (US1 + US2 only)

1. Complete Phase 1 (Setup)
2. Complete Phase 2 (Foundational)
3. Complete Phase 3 (US1) → dry-run works, DB inserts work, summary shown
4. Complete Phase 4 (US2) → categories correctly mapped
5. **STOP and VALIDATE**: Run dry-run, review preview file, run import, check Discord `/summary all`

### Incremental Delivery

1. Setup + Foundational → parsing infrastructure ready
2. US1 → rows are importable (plain tags, no category mapping yet)
3. US2 → categories correct
4. US3 → payment methods inferred
5. US4 → dry-run preview file workflow complete
6. Polish → end-to-end validated against real data

---

## Notes

- [P] tasks touch different functions or files — safe to start simultaneously
- Each US phase ends with a named checkpoint that can be validated without completing subsequent phases
- The migration script is a one-off tool; test coverage is manual validation against the real CSV per quickstart.md, not automated unit tests
- T027–T030 are the acceptance gate for SC-001 through SC-005 from the spec
