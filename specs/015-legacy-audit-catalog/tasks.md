# Tasks: Legacy Data Audit Catalog

**Input**: Design documents from `specs/015-legacy-audit-catalog/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/check-function.md ✓, contracts/report-format.md ✓, quickstart.md ✓

**Tests**: No automated tests — the script is validated manually by running it against the live DB and eyeballing the report (matches `migrate-legacy.ts` convention per plan.md).

**Organization**: Tasks grouped by user story. Single-file implementation: all code lives in `backend/scripts/audit-legacy.ts` under comment-section headers.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (logically independent — different functions in the same file section)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths included in each description

---

## Phase 1: Setup

**Purpose**: Create the script file skeleton and report output directory.

- [x] T001 Create `backend/scripts/audit-legacy.ts` with section comment headers: `// -- Imports/env --`, `// -- Types --`, `// -- Check helpers --`, `// -- Checks --`, `// -- Runner --`, `// -- Report --`, `// -- Diff loader --`, `// -- Main --`
- [x] T002 Create `specs/015-legacy-audit-catalog/audit-reports/.gitkeep` so the report output directory is tracked in the repo

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core runtime infrastructure that every check, the runner, and the renderer depend on.

**⚠️ CRITICAL**: No user story tasks can begin until this phase is complete.

- [x] T003 Define TypeScript interfaces `CheckContext`, `CheckResult`, `Check` (type alias), and `AuditReportSidecar` per `data-model.md` and `contracts/check-function.md` in `backend/scripts/audit-legacy.ts` under `// -- Types --`
- [x] T004 Implement manual `argv` parser for `--source <name>` flag (matching `migrate-legacy.ts` pattern — no library, ~20 lines) in `backend/scripts/audit-legacy.ts` under `// -- Main --`
- [x] T005 Implement `dotenv` env loading from `backend/.env` + Supabase service-role client init; exit with a clear error message before writing any report file if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing in `backend/scripts/audit-legacy.ts`
- [x] T006 Implement CHECKS registry pre-flight in `backend/scripts/audit-legacy.ts` under `// -- Runner --`: assert `name` uniqueness across the `CHECKS` array and assert `kind === 'sampler' ⟹ suggestedTool === 'inspect-only'`; throw before any DB query on violation
- [x] T007 Implement per-check error isolation in `backend/scripts/audit-legacy.ts` under `// -- Runner --`: wrap each `await check(ctx)` in try/catch; on throw substitute a synthetic `CheckResult` with `count: -1`, `description: 'ERROR: <msg>'`, `samples: []`, `kind: 'invariant'`, `suggestedTool: 'inspect-only'`
- [x] T008 Implement UTC timestamp generation (format `YYYY-MM-DDTHH-MM-SSZ`), auto-creation of `specs/015-legacy-audit-catalog/audit-reports/` via `fs.mkdirSync({recursive:true})`, and per-check console progress output (`[audit] running <name>... N matches (Xms)`) in `backend/scripts/audit-legacy.ts`

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 — Surface anomalies as structured catalog (Priority: P1) 🎯 MVP

**Goal**: Run `npx tsx scripts/audit-legacy.ts` from `backend/` and receive a markdown report with 10 check sections (6 invariants + 4 structural samplers) plus a matching JSON sidecar.

**Independent Test**: Run the script against the live database; confirm `specs/015-legacy-audit-catalog/audit-reports/<timestamp>.md` and `<timestamp>.json` both exist, the `.md` contains exactly 10 check sections, and a randomly chosen `transaction_id` from any invariant section is verifiable in the Supabase dashboard as exhibiting the described anomaly.

- [x] T009 [P] [US1] Implement `checkTransactionsWithoutItems` (FR-009): count + ≤5 sample `transactions` rows with zero `transaction_items` rows, `ORDER BY random() LIMIT 5`, apply `sourceFilter` when non-null, `suggestedTool: 'bulk'` in `backend/scripts/audit-legacy.ts`
- [x] T010 [P] [US1] Implement `checkItemsSumMismatch` (FR-010): count + sample `transactions` rows where all related items have non-null `amount` AND `SUM(item.amount) ≠ transaction.amount`, random sample, `sourceFilter`, `suggestedTool: 'case-by-case'` in `backend/scripts/audit-legacy.ts`
- [x] T011 [P] [US1] Implement `checkFeeRefundWithoutParent` (FR-011): count + sample `transactions` rows with `transaction_type IN ('fee','refund')` AND `parent_transaction_id IS NULL`, random sample, `sourceFilter`, `suggestedTool: 'bulk'` in `backend/scripts/audit-legacy.ts`
- [x] T012 [P] [US1] Implement `checkOrphanParentReference` (FR-012): count + sample `transactions` rows whose `parent_transaction_id` does not resolve to any `transactions.id`, random sample, `sourceFilter`, `suggestedTool: 'case-by-case'` in `backend/scripts/audit-legacy.ts`
- [x] T013 [P] [US1] Implement `checkCategoryTagOnTransaction` (FR-013): count + sample `transactions` rows whose `tags` array contains any element matching the `<text>:<text>` pattern, random sample, `sourceFilter`, `suggestedTool: 'bulk'` in `backend/scripts/audit-legacy.ts`
- [x] T014 [P] [US1] Implement `checkOrphanCategoryTagOnItem` (FR-014): count + sample `transaction_items` rows whose `tags` array contains `<text>:<text>` elements not present as `(major, subcategory)` in the `categories` table; include both `item_id` and `transaction_id` in each sample; apply `sourceFilter` via parent-transaction join; `suggestedTool: 'case-by-case'` in `backend/scripts/audit-legacy.ts`
- [x] T015 [P] [US1] Implement `samplerTransactionsByShape` (FR-015 bucket 1): group transactions by `(has_note: bool, items_count_bucket: 0|1|2-3|4+, has_plain_tags: bool)` with count per bucket; `kind: 'sampler'`, `suggestedTool: 'inspect-only'`, apply `sourceFilter` in `backend/scripts/audit-legacy.ts`
- [x] T016 [P] [US1] Implement `samplerLongestNotes` (FR-015 bucket 3): top 20 `transactions` rows by `LENGTH(note) DESC`; include `transaction_id`, `note` (truncate display at 200 chars), `source`; apply `sourceFilter`; `kind: 'sampler'`, `suggestedTool: 'inspect-only'` in `backend/scripts/audit-legacy.ts`
- [x] T017 [P] [US1] Implement `samplerLongestTagsArrays` (FR-015 bucket 4): top 20 `transactions` rows by `array_length(tags,1) DESC`; include `transaction_id`, `tags`, `source`; apply `sourceFilter`; `kind: 'sampler'`, `suggestedTool: 'inspect-only'` in `backend/scripts/audit-legacy.ts`
- [x] T018 [P] [US1] Implement `samplerLongestItemNames` (FR-015 bucket 5): top 20 `transaction_items` rows by `LENGTH(name) DESC`; include `item_id`, `transaction_id`, `name`, `amount`; join to parent transaction for `sourceFilter`; `kind: 'sampler'`, `suggestedTool: 'inspect-only'` in `backend/scripts/audit-legacy.ts`
- [x] T019 [US1] Implement markdown report renderer in `backend/scripts/audit-legacy.ts` under `// -- Report --`: report header (`**Source filter**`, `**Total transactions scanned**`, `**Generated**`); `## Invariant Violations` section; `## Structural Samplers` section; per-check section variants for invariant, sampler, ERROR (`count: -1`), and zero-count cases per `contracts/report-format.md`; render samples as a markdown table using object keys as column headers (truncate to 5 rows silently)
- [x] T020 [US1] Implement JSON sidecar writer in `backend/scripts/audit-legacy.ts` under `// -- Report --`: write `<ts>.json` alongside `<ts>.md` containing `AuditReportSidecar` (`schemaVersion:1`, `generatedAt`, `sourceFilter`, `totalTransactionsScanned`, per-check slim snapshot with `count`, `kind`, `suggestedTool`, `description`, `errored`) using `fs.writeFileSync`
- [x] T021 [US1] Register T009–T018 check functions in the `CHECKS` array and wire runner → renderer → sidecar-writer into `main` in `backend/scripts/audit-legacy.ts`; confirm the script produces a report pair with no diff section on first run (no prior sidecar exists)

**Checkpoint**: User Story 1 fully functional — script produces a 10-section `.md` report + `.json` sidecar on first run.

---

## Phase 4: User Story 2 — Iterative progress tracking via diff (Priority: P1)

**Goal**: After a cleanup pass, re-running the audit prepends a "Diff vs prior" section with signed per-check deltas showing progress.

**Independent Test**: Produce a baseline report; manually update 5 rows exhibiting a known invariant violation; re-run; confirm the diff section shows the expected count reduction for that check and leaves other checks unchanged.

- [x] T022 [US2] Implement `loadPriorSidecar` in `backend/scripts/audit-legacy.ts` under `// -- Diff loader --`: `readdir` the report directory for `*.json` files; sort lexicographically; exclude the current run's stem; pick the last remaining entry; `JSON.parse`; validate `schemaVersion === 1` (warn to console and return `null` on mismatch or parse error); return `null` when no prior file exists
- [x] T023 [US2] Implement diff computation in `backend/scripts/audit-legacy.ts` under `// -- Diff loader --`: walk the union of current `CheckResult[]` names and prior `AuditReportSidecar.checks` keys; produce signed integer delta per check; annotate `(new)` for checks absent from prior (FR-008), `(removed)` for checks absent from current (FR-007), and `(sampler)` / `—` for sampler rows (no meaningful numeric delta)
- [x] T024 [US2] Implement diff markdown table renderer (columns: `Check | Prior | Current | Delta`) in `backend/scripts/audit-legacy.ts` under `// -- Report --` per the diff section layout in `contracts/report-format.md`
- [x] T025 [US2] Wire `loadPriorSidecar` + diff renderer into the report: call `loadPriorSidecar` before rendering; prepend `## Diff vs <prior-stem>` section when a prior sidecar is returned (FR-005); omit the section entirely when `null` is returned (FR-006) in `backend/scripts/audit-legacy.ts`

**Checkpoint**: User Stories 1 and 2 both work — second run shows a diff section with correct signed deltas.

---

## Phase 5: User Story 3 — Validate non-legacy sources stay clean (Priority: P2)

**Goal**: The report contains a `sampler.transactions_by_source` section showing per-source totals cross-referenced against each invariant violation count.

**Independent Test**: Run the audit and read the `sampler.transactions_by_source` section; verify one row per distinct `transactions.source` value, each showing total transaction count and individual violation counts for FR-009 through FR-013.

- [x] T026 [US3] Implement `samplerTransactionsBySource` (FR-015 bucket 2): one row per distinct `transactions.source` value with `total` count + individual violation counts for each of FR-009 through FR-013 (reuse the same predicates as the invariant checks or run sub-counts in one query); apply `sourceFilter` when non-null (results in one source row); `kind: 'sampler'`, `suggestedTool: 'inspect-only'` in `backend/scripts/audit-legacy.ts`
- [x] T027 [US3] Register `samplerTransactionsBySource` in the `CHECKS` array as position 2 in the sampler block (immediately after `samplerTransactionsByShape`, before the longest-N samplers) in `backend/scripts/audit-legacy.ts`

**Checkpoint**: All three P1/P2 user stories independently functional — 11 check sections total.

---

## Phase 6: User Story 4 — Extensibility (Priority: P3)

**Goal**: Confirm the registry pattern and error-isolation architecture work as specified: adding a new check requires exactly one function definition plus one array-entry registration, with no other code changes.

**Independent Test**: Add a trivial check function (`checkHighValueTransactions` — transactions where `amount > 100000`, `suggestedTool: 'inspect-only'`); re-run; confirm N+1 sections in the report and the diff shows the new check as `(new)`; then remove the trivial check.

- [x] T028 [US4] Validate extensibility end-to-end: add `checkHighValueTransactions` (transactions with `amount > 100000`, `kind: 'invariant'`, `suggestedTool: 'inspect-only'`) + one `CHECKS` push in `backend/scripts/audit-legacy.ts`; run the script; verify N+1 sections appear and diff shows `(new)`; confirm no changes were required in runner, renderer, or diff loader; then remove the trivial check

**Checkpoint**: All user stories complete. Script is ready for the iterative cleanup loop.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Edge-case handling, source-filter UX polish, and final smoke validation per `quickstart.md`.

- [x] T029 [P] Add source-filter zero-match notice to report header: when `--source <name>` is supplied and no transactions match, render a prominent `> Filtered to source=<name>: 0 transactions matched` line immediately after the header block in `backend/scripts/audit-legacy.ts` under `// -- Report --`
- [x] T030 [P] Add unknown-source warning to console in `backend/scripts/audit-legacy.ts` under `// -- Main --`: if `sourceFilter` is set and not in the known set (`legacy_migration`, `discord`, `pwa`, `invoice`, `android`), print `[audit] WARNING: unknown source value '<x>' — query will likely return 0 rows`; warn only, do not reject
- [x] T031 Run full end-to-end smoke test per `quickstart.md`: `cd backend && npx tsx scripts/audit-legacy.ts`; verify `specs/015-legacy-audit-catalog/audit-reports/<ts>.md` and `<ts>.json` created; confirm all 11 check sections present; spot-verify 1–2 sample `transaction_id` values in Supabase dashboard; re-run and verify diff section appears with correct structure

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2; T009–T018 [P] can proceed in any order; T019–T020 can be worked in parallel with T009–T018; T021 requires T009–T020 complete
- **US2 (Phase 4)**: Depends on Phase 3 (renderer + sidecar writer must exist); T022–T024 can proceed in parallel with US3 Phase 5
- **US3 (Phase 5)**: Depends on Phase 2 only; T026 can be written in parallel with T022–T024 (independent function, no cross-dependency)
- **US4 (Phase 6)**: Depends on Phases 3–5 complete (validates the full system)
- **Polish (Phase 7)**: Depends on Phase 6

### User Story Dependencies

- **US1 (P1)**: Core scaffold — US2 and US4 layer on top; US3 is parallel
- **US2 (P1)**: Depends on US1 (needs renderer + sidecar writer); independent of US3
- **US3 (P2)**: Depends on Phase 2 only; can be implemented in parallel with US2 (different function, no shared state)
- **US4 (P3)**: Depends on US1 + US2 complete (validates end-to-end flow including diff)

### Parallel Opportunities

- T009–T018 (10 check functions): all independent — each is a standalone async function in `// -- Checks --`
- T019 (markdown renderer) and T020 (JSON sidecar writer): can be written while checks are being implemented; only depend on `CheckResult` type (T003)
- T022–T024 (diff loader, computation, renderer) and T026 (by-source sampler): can proceed in parallel after Phase 2

---

## Parallel Example: Phase 3 (US1 checks)

```bash
# All 6 invariant check functions are independent — implement in any order:
T009: checkTransactionsWithoutItems
T010: checkItemsSumMismatch
T011: checkFeeRefundWithoutParent
T012: checkOrphanParentReference
T013: checkCategoryTagOnTransaction
T014: checkOrphanCategoryTagOnItem

# All 4 structural samplers are independent:
T015: samplerTransactionsByShape
T016: samplerLongestNotes
T017: samplerLongestTagsArrays
T018: samplerLongestItemNames
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational — CRITICAL, blocks all stories
3. Complete Phase 3: User Story 1 (T009–T021)
4. **STOP and VALIDATE**: Run `npx tsx scripts/audit-legacy.ts` from `backend/`; eyeball report; confirm 10 sections and JSON sidecar
5. Proceed to US2 diff tracking

### Incremental Delivery

1. Setup + Foundational → runnable skeleton (no checks yet)
2. US1 → full 10-check report + JSON sidecar; **cleanup loop can begin immediately using the report**
3. US2 → diff section added on second run; owner can track progress
4. US3 → source-distribution sampler; regression sentinel for live entry paths
5. US4 + Polish → extensibility validated; edge cases handled; ready for iterative check additions

---

## Notes

- **Single file**: All code in `backend/scripts/audit-legacy.ts` under comment-section headers. Do not pre-split into modules; refactor only if the file exceeds ~600 LOC.
- **No new dependencies**: `@supabase/supabase-js` and `dotenv` are already in `backend/`. CLI parsing is manual `argv` walking.
- **No automated tests**: Manual validation by running the script per `quickstart.md`. The report itself is the test artefact.
- **[P] tasks**: logically independent functions within the same file — implement in any order within their phase.
- **Read-only guarantee**: No check function may issue `INSERT`, `UPDATE`, `DELETE`, or DDL (FR-003). Let errors propagate — the runner catches them.
- Commit after each phase checkpoint to preserve progress.
