# Feature Specification: Legacy Data Audit Catalog

**Feature Branch**: `015-legacy-audit-catalog`
**Created**: 2026-05-23
**Status**: Draft
**Input**: User description: "Legacy data audit catalog tool — re-runnable script that surfaces transaction/items anomalies as markdown reports to drive iterative cleanup of ~17k rows from legacy CSV migration."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Surface anomalies as a structured catalog (Priority: P1)

The owner of the expense-tracker database runs a single command and receives a markdown report enumerating every detectable anomaly category in the current data, with row counts and sample rows for each category. The report is detailed enough that the owner can immediately pick one category and write a targeted cleanup script or one-off SQL fix, without first having to hunt through 17,000 rows to discover what is wrong.

**Why this priority**: Without this report the owner is stuck doing slow row-by-row inspection in the Supabase dashboard and has already given up after cleaning ~1/3 of the legacy data. Producing the catalog is the precondition for every subsequent cleanup action and unblocks the rest of the legacy data quality work.

**Independent Test**: Can be fully tested by running the script against the live database and confirming the markdown report is produced, contains every defined check section, and that sample rows in each section reference real, queryable `transaction_id` values that match the described anomaly when looked up in the database.

**Acceptance Scenarios**:

1. **Given** the database in its current state, **When** the audit script is executed with no arguments, **Then** a markdown file is written to `specs/015-legacy-audit-catalog/audit-reports/<UTC-timestamp>.md` containing one section per check with name, description, count, and 3–5 sample rows.
2. **Given** the script has just produced a report, **When** the database has not been modified, **Then** re-running the script produces a new report whose counts match the previous report exactly.
3. **Given** a report has been produced for an invariant check (e.g., transactions with zero items), **When** the owner picks any `transaction_id` from that section's samples and inspects it in the Supabase dashboard, **Then** the row demonstrably exhibits the anomaly described by the check.

---

### User Story 2 - Iterative progress tracking via diff (Priority: P1)

After the owner cleans one anomaly category (for example, by running a bulk-fix script that resolves a few thousand rows), they re-run the audit and the new report begins with a clearly visible "Diff vs prior run" summary that shows, per check, the previous count, the new count, and the delta. The owner can see at a glance which categories shrank, which are unchanged, and what is left to tackle next.

**Why this priority**: Cleanup is an iterative loop, not a one-shot job. Without explicit progress feedback the owner cannot tell whether their last script actually moved the needle, and the loop loses momentum. The diff turns the audit from "a report" into "the dashboard for the cleanup project."

**Independent Test**: Can be tested by producing a baseline report, deliberately fixing a small known subset of one anomaly (e.g., manually updating five rows that previously had a sum mismatch), re-running the audit, and confirming the new report's diff section shows the expected count reduction in that category.

**Acceptance Scenarios**:

1. **Given** at least one prior report exists in the report directory, **When** the audit script is executed, **Then** the new report's first section is titled "Diff vs <prior-timestamp>" and lists every check with prior count, new count, and signed delta.
2. **Given** no prior report exists, **When** the audit script is executed, **Then** the report omits the diff section and proceeds directly to the check sections without error.
3. **Given** the prior report contains a check that no longer exists in the current script (a check was removed), **When** the audit is executed, **Then** the diff section flags the removed check as "(removed)" rather than failing.
4. **Given** the current script contains a check that did not exist in the prior report (a check was added), **When** the audit is executed, **Then** the diff section flags the added check as "(new)" with no prior count.

---

### User Story 3 - Validate that non-legacy entry paths stay clean (Priority: P2)

The owner runs the audit script and reviews the per-source breakdown in the structural sampler section. If anomalies are highly concentrated in `source = legacy` and nearly absent in `source IN (manual, discord, invoice, android)`, that validates the assumption that the live entry paths produce clean data and only legacy data needs cleanup. If anomalies appear in non-legacy sources at meaningful counts, the owner has discovered a regression in the input flow that needs a separate fix.

**Why this priority**: This is the secondary diagnostic value of the audit — beyond cleanup, it doubles as a regression sentinel for the data-entry code paths. Lower priority than P1 because the owner's working assumption is already that legacy is the only dirty source; this just confirms or refutes it.

**Independent Test**: Can be tested by reading the source-distribution section of any produced report and verifying that the non-legacy buckets show zero or near-zero counts for invariant violations.

**Acceptance Scenarios**:

1. **Given** the audit script has been run, **When** the owner reads the "transactions grouped by source" structural sampler section, **Then** they see one row per source value with its total transaction count and per-source counts for each invariant violation check.
2. **Given** a non-legacy source shows a non-zero invariant violation count, **When** the owner inspects the sample rows for that source, **Then** the sample is sufficient to identify which entry path produced the bad row.

---

### User Story 4 - Extending the script with new pattern checks (Priority: P3)

After eyeballing the first few reports, the owner identifies a specific anomaly pattern (e.g., "transactions where `note` contains a number+name repeating pattern, indicating items info was stuffed into the note field"). They — or a future implementor — can add a new check to the script by writing a single function and registering it in a list, without modifying the existing checks, report rendering, or diff logic.

**Why this priority**: The first version is intentionally lean; pattern-specific detectors get added over time as the owner discovers patterns from the structural samplers. This extensibility must be preserved or the audit becomes a write-once dead end.

**Independent Test**: Can be tested by writing a trivial new check function (e.g., "transactions with `amount > 100000`"), registering it, re-running the script, and confirming the new check appears as its own section in the report and in the diff against the prior report (as "(new)").

**Acceptance Scenarios**:

1. **Given** the script has N registered checks, **When** a developer adds one new check function and registers it, **Then** the script produces a report with N+1 check sections without any other code changes.
2. **Given** a check function raises an unexpected error, **When** the script runs, **Then** the failing check is reported with an "ERROR: <message>" placeholder and the script continues with the remaining checks rather than aborting the entire report.

---

### Edge Cases

- **Empty database**: If a check has zero matching rows, the section still appears in the report with `count: 0` and a "(no rows match this check)" placeholder — never omitted, so the diff against prior runs is always meaningful.
- **First run, no prior report**: Report omits the diff section entirely; does not fail.
- **Source filter with no matches**: If `--source <name>` is supplied and no rows match that source, every check returns zero and the report makes this explicit at the top ("Filtered to source=<name>: 0 transactions matched").
- **Report directory missing**: Script creates `specs/015-legacy-audit-catalog/audit-reports/` if it does not already exist.
- **Concurrent run on stale data**: Reports are timestamped at the start of the run; a long-running audit reflects a roughly point-in-time snapshot (small drift over the run window is acceptable; no transactional snapshot needed).
- **Sample selection bias**: Samples within each check are taken without bias toward newest or oldest rows (e.g., random selection or stable hash-based ordering), so the same anomaly category does not always surface the same five rows across multiple runs — the owner gets to see different examples over time.
- **Removed check in diff**: A check present in the prior report but absent from the current script appears in the diff section as "(removed)" with the prior count, not as an error.
- **Service-role connection failure**: If the database connection fails at startup, the script exits with a clear error message before writing any partial report file.

---

## Requirements *(mandatory)*

### Functional Requirements

#### Report generation

- **FR-001**: The audit script MUST produce a single markdown report file per invocation, written under `specs/015-legacy-audit-catalog/audit-reports/` with a UTC-timestamped filename.
- **FR-002**: The report MUST contain one section per registered check, in stable order, with the section title, a one-line description, the matching row count, suggested cleanup tool tag (`bulk` / `case-by-case` / `inspect-only`), and 3–5 sample rows containing at minimum `transaction_id` plus the field(s) relevant to the check.
- **FR-003**: The script MUST be read-only against the database — no `INSERT`, `UPDATE`, `DELETE`, or DDL operations under any code path.
- **FR-004**: A check with zero matching rows MUST still appear as a section in the report with `count: 0` (not omitted), so diffs remain stable.

#### Diff against prior run

- **FR-005**: At report-generation time, the script MUST detect the most recent prior report in the report directory (if any) and emit a "Diff vs <prior-timestamp>" leading section listing per-check prior count, new count, and signed delta.
- **FR-006**: When no prior report exists, the diff section MUST be omitted (not emitted as an empty section).
- **FR-007**: When the prior report contains a check that no longer exists in the current script, the diff MUST list it as "(removed)" with its prior count.
- **FR-008**: When the current script contains a check absent from the prior report, the diff MUST list it as "(new)" with no prior count.

#### Initial invariant checks

The first version MUST include the following six invariant-violation checks. Each runs against the full `transactions` / `transaction_items` data (subject to the optional source filter from FR-016):

- **FR-009**: Check "transactions without items" — counts and samples `transactions` rows that have zero corresponding `transaction_items` rows.
- **FR-010**: Check "items sum mismatch" — counts and samples `transactions` rows where every related item has a non-null amount AND the sum of those item amounts is not equal to the transaction's own amount.
- **FR-011**: Check "fee/refund without parent" — counts and samples `transactions` rows with `transaction_type IN ('fee', 'refund')` AND `parent_transaction_id IS NULL`.
- **FR-012**: Check "orphan parent reference" — counts and samples `transactions` rows whose `parent_transaction_id` does not resolve to any existing `transactions.id`.
- **FR-013**: Check "category tag on transaction" — counts and samples `transactions` rows whose `tags` array contains any element matching the pattern `<text>:<text>` (i.e. category tags that should live only on items, per the target schema decision).
- **FR-014**: Check "orphan category tag on item" — counts and samples `transaction_items` rows whose `tags` array contains any element matching the pattern `<text>:<text>` that is not present as a `(major, subcategory)` pair in the `categories` table.

#### Initial structural samplers

- **FR-015**: The first version MUST include the following five structural sampler sections, each reporting counts plus 3–5 sample rows per bucket (no judgment, no `suggestedTool` of `bulk`/`case-by-case` — these are always `inspect-only`):
  - "Transactions by shape" — buckets keyed by `(has_note: bool, items_count_bucket: 0 | 1 | 2-3 | 4+, has_plain_tags: bool)`.
  - "Transactions by source" — one row per distinct `source` value with total count and a per-source count for each invariant violation check (FR-009 through FR-013).
  - "Longest `note` values" — top 20 `transactions` rows ordered by `LENGTH(note)` descending.
  - "Longest `tags` arrays on transaction" — top 20 `transactions` rows ordered by array length descending.
  - "Longest `name` values on items" — top 20 `transaction_items` rows ordered by `LENGTH(name)` descending.

#### Source filter

- **FR-016**: The script MUST accept an optional `--source <name>` flag; when supplied, every invariant check and every structural sampler operates only on rows whose transaction's `source` equals the given value. When omitted, all sources are included.
- **FR-017**: When a source filter is active, the report header MUST explicitly state the active filter so reports under different filters cannot be confused.

#### Extensibility

- **FR-018**: Each check MUST be implemented as a standalone function whose return shape includes (at minimum) the check name, count, samples array, and suggested cleanup tool tag. Adding a new check MUST require registering one additional function in a single list and changing no other code.
- **FR-019**: If a check function raises an unhandled error at runtime, the script MUST emit that check's section with an "ERROR: <message>" placeholder and continue with the remaining checks rather than aborting the report.

#### Sample selection

- **FR-020**: Samples within a check MUST NOT be biased toward newest or oldest rows. Sampling MUST yield meaningful variety across repeated runs against unchanged data so the owner can observe different examples over time. Stable identifiers (e.g., `transaction_id`) MUST always be included in each sample.

### Key Entities *(include if feature involves data)*

- **Audit Report**: A timestamped markdown document representing one execution of the audit. Contains an optional diff header (vs the prior report), one section per registered check, and metadata identifying the active source filter (if any). Stored under `specs/015-legacy-audit-catalog/audit-reports/`.
- **Check**: A named anomaly-detection unit with a description, a matching predicate over the data, a count, a list of sample rows, and a suggested cleanup tool tag. Two flavors exist initially: *invariant violation* (FR-009 through FR-014) and *structural sampler* (FR-015). Both share the same return shape so the report renderer treats them uniformly.
- **Sample Row**: A small structured snapshot of one anomalous row containing the stable identifier (`transaction_id`) plus the field(s) relevant to the check that produced it. The renderer formats samples as a compact list or table within each section.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After running the audit once, the owner can identify the single highest-volume anomaly category in under 30 seconds of skimming the report.
- **SC-002**: Re-running the audit after a cleanup pass produces a diff section whose deltas the owner can verify against the cleanup script's stated effect in under 60 seconds.
- **SC-003**: All six initial invariant checks (FR-009 through FR-014) and all five initial structural samplers (FR-015) produce results from a single end-to-end run against the live database without manual intervention.
- **SC-004**: Adding a new check function takes a developer no more than one function definition plus one list-registration edit — no rendering, diff, or CLI changes required.
- **SC-005**: The non-legacy source buckets (`manual`, `discord`, `invoice`, `android`) in the source-distribution sampler show zero or near-zero invariant violation counts on the first run, validating the assumption that only legacy data is dirty. (If they do not, the owner has discovered a regression — also a successful outcome of the audit.)
- **SC-006**: A read-only audit run against the current ~17k-row database completes within 5 minutes wall-clock on a typical developer machine, allowing the owner to iterate cleanup loops without long delays.

## Assumptions

- The `categories` table is authoritative for "valid `(major, subcategory)` pairs" by the time the audit is first run — i.e., spec 014 has been merged and seeded. Orphan-category-tag detection (FR-014) depends on this.
- `transactions.source` is populated for the vast majority of rows. Rows with `NULL` or unrecognized source values are bucketed under `unknown` in the per-source sampler rather than rejected.
- The owner does not need an interactive cleanup interface as part of this feature. Cleanup happens externally to the audit — via one-off SQL, ad-hoc `tsx` scripts, or (eventually) a PWA edit screen — and the audit only surfaces the work to be done.
- The audit script reuses the Supabase service-role credential pattern already established by other scripts under `backend/scripts/` (read from `.env`). No new secret management is introduced.
- A future `transaction_adjustments` table will eventually replace the current pattern of fee/refund being stored as separate `transactions` rows linked via `parent_transaction_id`. That migration is **out of scope** for this feature; FR-011 and FR-012 are written against the current shape and will need updating in a later spec once the new table exists.
- A Postgres `VIEW v_transactions_full` to aggregate items and adjustments back into a single browseable row is a separate future feature (decoupled from the audit). The audit script reads the base tables directly.
- Bias-free sampling (FR-020) does not require a cryptographic RNG — any approach that visibly varies samples across runs (e.g., `ORDER BY random()` or a stable hash with a per-run salt) is acceptable.
