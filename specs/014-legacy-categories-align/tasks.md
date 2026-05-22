# Tasks: Legacy Category Curation & Migration

**Input**: Design documents from `specs/014-legacy-categories-align/`  
**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ quickstart.md ✅

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files / independent code paths)
- **[Story]**: US1–US4 maps to user stories in spec.md

---

## Phase 1: Setup

**Purpose**: Confirm working environment before any code changes.

- [ ] T001 Verify `backend/.env` contains `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and that the NaggingMoney CSV (`NaggingMoney_20260516082424_utf8.csv`) is present at the project root

**Checkpoint**: Prerequisites confirmed — can begin implementation.

---

## Phase 2: User Story 1 — Subcategory Frequency Table (Priority: P1) 🎯 MVP

**Goal**: `migrate-legacy.ts --dry-run` emits a per-subcategory frequency table sorted by count descending, which is the primary tool for curation decisions.

**Independent Test**: Run `npx tsx scripts/migrate-legacy.ts --dry-run ../NaggingMoney_*.csv` and confirm `dry-run-*.txt` contains a "Subcategory breakdown" section listing every `major:subcategory` pair with its transaction count.

- [ ] T002 [US1] In `writeDryRunFile` in `backend/scripts/migrate-legacy.ts`: after the existing "Category coverage" block, add a "Subcategory breakdown" section — iterate `rows` (already parsed `ParsedLegacyRow[]`), filter `tags` entries matching `/^[^:]+:[^:]+$/`, accumulate counts in a `Map<string, number>`, sort descending by count, write to the report file with format `  食:早餐              1420`
- [ ] T003 [US1] Run `npx tsx scripts/migrate-legacy.ts --dry-run ../NaggingMoney_20260516082424_utf8.csv` from `backend/`; open `dry-run-*.txt` and verify the subcategory breakdown section appears with counts sorted descending — this output is the baseline inventory for curation

**Checkpoint**: Subcategory inventory is available. Curation can now begin.

---

## Phase 3: User Story 2 — Iterative Category Curation (Priority: P1)

**Goal**: Parser config (`SUBCATEGORY_REMAP`, `TAG_CORRECTIONS`, `BEIZHU_RULES`) updated so the dry-run produces a clean, intentional taxonomy with no unwanted long-tail subcategories.

**Independent Test**: After config updates, re-run dry-run and confirm the subcategory list is shorter and more consolidated than the T003 baseline — no unwanted entries remain.

- [ ] T004 [US2] Review the full `dry-run-*.txt` subcategory breakdown from T003; note all subcategories to merge, rename, or reclassify — focus on high-frequency entries first
- [ ] T005 [US2] Resolve the three seed/parser name conflicts in `backend/src/services/legacy-csv-config.ts`: decide canonical names for `計程車` vs `搭計程車`, `油費` vs `加油費`, `住:租金` vs `住:房租` — update `SUBCATEGORY_REMAP` to produce the chosen canonical name for each
- [ ] T006 [US2] Consolidate long-tail subcategories in `食`, `行`, `醫`, `樂`, `育` majors — add `SUBCATEGORY_REMAP` or `TAG_CORRECTIONS` entries in `backend/src/services/legacy-csv-config.ts` to merge overly specific subcategories into broader ones
- [ ] T007 [US2] Consolidate subcategories in `其他` and `衣` majors — add `SUBCATEGORY_REMAP` or `TAG_CORRECTIONS` entries in `backend/src/services/legacy-csv-config.ts` to reduce the long tail
- [ ] T008 [US2] Re-run dry-run after T005–T007 changes and review updated subcategory list; repeat T006–T008 iterations as needed until taxonomy is clean and subcategory count is at user's target

**Checkpoint**: Final dry-run output reflects the intended taxonomy. Config changes are complete.

---

## Phase 4: User Story 3 — SQL Migration (Priority: P2)

**Goal**: `012_legacy_categories.sql` applied to DB so every curated `(major, subcategory)` pair has a row in `categories` before the data migration runs.

**Independent Test**: After applying SQL migration, query `categories` table and confirm all expected majors (`其他`, `衣`, etc.) and their curated subcategories are present.

- [ ] T009 [US3] Write `backend/supabase/migrations/012_legacy_categories.sql` — use the final dry-run subcategory list as source: include `(其他, NULL)` and `(衣, NULL)` major-level rows first, then all curated `(major, subcategory)` pairs not already in the 011 seed, all using `INSERT … ON CONFLICT DO NOTHING`; set `sort_order` in multiples of 10 in descending frequency order appended after each major's existing max `sort_order`
- [ ] T010 [US3] Apply `012_legacy_categories.sql` to the Supabase DB (`npx supabase db push` or via dashboard SQL editor)
- [ ] T011 [US3] Verify categories table: query `SELECT major, subcategory FROM categories ORDER BY major, sort_order` and confirm all curated categories are present; confirm `其他` and `衣` appear with their subcategories

**Checkpoint**: Categories table is complete. Data migration can now run safely.

---

## Phase 5: User Story 4 — Auto-Upsert on Future Runs (Priority: P3)

**Goal**: `migrate-legacy.ts` automatically upserts any `major:subcategory` it encounters into the `categories` table before inserting transactions, in both live and dry-run modes.

**Independent Test**: Add a new `TAG_CORRECTIONS` entry producing a novel `major:subcategory`. Run dry-run → verify "would create categories" section lists it. Run live → verify the category row is created before the transaction.

- [ ] T012 [US4] In `main` (live branch) in `backend/scripts/migrate-legacy.ts`: before the batch insert loop, collect all unique `major:subcategory` tags from `rows` (regex `/^[^:]+:[^:]+$/`), build category upsert rows `{ major, subcategory, sort_order: 9999 }`, call `supabase.from('categories').upsert(rows, { onConflict: 'major,subcategory', ignoreDuplicates: true })`
- [ ] T013 [US4] In `main` (dry-run branch) in `backend/scripts/migrate-legacy.ts`: collect the same unique `major:subcategory` set and append a "Would create categories: N" section to the console summary (listing the pairs) — no DB writes

**Checkpoint**: Script is self-contained for future re-runs.

---

## Phase 6: Run & Verify

**Purpose**: Execute both migrations end-to-end and confirm all success criteria.

- [ ] T014 Run `npx tsx scripts/migrate-legacy.ts ../NaggingMoney_20260516082424_utf8.csv` from `backend/`; confirm terminal summary shows ~15,200 imported expense rows, ~6 income→refund rows, 0 deduplicated, 0 unmapped categories
- [ ] T015 Verify SC-003 — run the verification SQL query from `quickstart.md §Step 6` confirming zero legacy transaction tags are unmatched in the categories table
- [ ] T016 Verify SC-004 — open PWA category picker, select `其他` major, confirm subcategory list is populated with curated entries (e.g., `電信費`, `手續費`, `國外交易服務費`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US1)**: Depends on Phase 1
- **Phase 3 (US2)**: Depends on Phase 2 completion — dry-run output needed as input
- **Phase 4 (US3)**: Depends on Phase 3 completion — curated taxonomy must be final
- **Phase 5 (US4)**: Can start after Phase 2 — independent of curation and SQL migration
- **Phase 6 (Run & Verify)**: Depends on Phase 4 AND Phase 5

### User Story Dependencies

- **US1 (P1)**: Starts after setup — no other story dependency
- **US2 (P1)**: Depends on US1 output (dry-run subcategory table must exist)
- **US3 (P2)**: Depends on US2 completion (curated taxonomy must be final)
- **US4 (P3)**: Independent — can be done in parallel with US2/US3 after US1

### Parallel Opportunities

```
Phase 2 complete →
  ├── Phase 3 (US2 curation) starts sequentially
  └── Phase 5 (US4 T012+T013) can start in parallel with Phase 3

Phase 3 + Phase 5 both complete →
  └── Phase 4 (US3 SQL migration) starts

Phase 4 complete →
  └── Phase 6 (run & verify)
```

---

## Implementation Strategy

### MVP (US1 + US2 + US3 — the critical path)

1. T001 — Verify prerequisites
2. T002–T003 — Implement and verify subcategory table in dry-run
3. T004–T008 — Curate taxonomy iteratively
4. T009–T011 — Write and apply SQL migration
5. **Stop and validate**: all curated categories in DB, ready to migrate
6. T014–T016 — Run live migration, verify

### Full Delivery (adds US4)

Add T012–T013 (auto-upsert) in parallel with curation (after T003). Included in Phase 6 verification.

---

## Notes

- The curation loop (T004–T008) is the most time-consuming step and is intentionally iterative — no fixed end state, user decides when taxonomy is clean enough
- T008 is a loop gate: re-run dry-run as many times as needed, then proceed when satisfied
- The SQL migration (T009) can only be written after T008 is complete
- T012 and T013 modify the same function (`main`) in different branches — implement sequentially in one pass
- Commit after T003 (code change validated), after T008 (curation complete), after T009–T010 (SQL migration applied), after T012–T013 (script update)
