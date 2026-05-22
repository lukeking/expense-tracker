# Feature Specification: Legacy Category Curation & Migration

**Feature Branch**: `014-legacy-categories-align`  
**Created**: 2026-05-20  
**Status**: Draft  
**Input**: User description: "now we can go back to legacy migration, based on recent commits, esp. new db table categories"

---

## Background

The legacy NaggingMoney CSV contains 17,000+ rows spanning 10+ years (~2,000 of which are type-99 daily balance markers that are skipped, leaving ~15,000+ actual transactions). The parser (`legacy-csv-parser.ts`) converts them into tagged transactions using a large config layer (`BEIZHU_RULES` ~1,000 lines, `TAG_CORRECTIONS`, `SUBCATEGORY_REMAP`). These rules were written incrementally during development and reflect the raw diversity of the source data — producing a long tail of highly specific `major:subcategory` combinations that are too granular or inconsistent for ongoing use.

The `categories` table (migration 011) now defines the authoritative taxonomy used by the PWA. Before running the data migration, the user wants to review the full set of categories the parser currently produces, consolidate them into a clean and intentional taxonomy, and update the parser config to implement those decisions. Only then are the SQL migration and data migration run.

This is an iterative curation workflow: enumerate → review → consolidate → verify → migrate. The config changes made during curation may affect hundreds of rules across `BEIZHU_RULES`, `TAG_CORRECTIONS`, and `SUBCATEGORY_REMAP`.

---

## Clarifications

### Session 2026-05-20

- Q: What should be the source used to determine which `(major, subcategory)` rows to insert into the SQL migration? → A: Static analysis of the parser config files (`CATEGORY_MAP`, `TAG_CORRECTIONS`, `SUBCATEGORY_REMAP`, `legacy-csv-parser.ts`). DB is clean — the data migration has not yet run, so querying live transactions is not possible. The SQL migration must be generated from code analysis and applied before the data migration runs.
- Q: Context clarification — DB state and true feature intent. → A: DB is truncated to clean state (only categories table seeded). The real goal is not just to enumerate existing parser output into the categories table, but to first curate the taxonomy: review what the parser produces, decide which categories to keep/merge/rename, update the parser config accordingly, then write the SQL migration from the curated result. Config changes during curation will significantly affect BEIZHU_RULES (~1,000 lines), TAG_CORRECTIONS, and SUBCATEGORY_REMAP.

---

## User Scenarios & Testing

### User Story 1 — Generate Full Category Inventory from CSV (Priority: P1)

The user runs the migration script in dry-run mode against the full NaggingMoney CSV. The output includes a complete, deduplicated list of every `major:subcategory` pair that would be assigned to transactions, along with the frequency count for each. The user can use this list as the starting point for curation decisions.

**Why this priority**: Without a clear enumeration of what the parser currently produces, the user cannot make informed curation decisions. This is the input to the entire workflow.

**Independent Test**: Run `migrate-legacy.ts --dry-run` and verify the output includes a category frequency table covering all unique `major:subcategory` pairs, sorted by count descending.

**Acceptance Scenarios**:

1. **Given** the full CSV, **When** dry-run is executed, **Then** the output includes a section listing every unique `major:subcategory` pair and its frequency (number of transactions that would receive that tag).
2. **Given** the dry-run output, **When** the user reads the category list, **Then** it is sorted by frequency descending so high-volume categories are visible first.
3. **Given** tags that are plain store names (no `:` separator), **When** the dry-run produces its category list, **Then** those plain tags are excluded — only `major:subcategory` formatted tags appear in the category inventory.

---

### User Story 2 — Curate the Category Taxonomy Iteratively (Priority: P1)

The user reviews the category inventory and decides which subcategories to keep, merge into broader ones, or rename. They update the parser config (`SUBCATEGORY_REMAP`, `TAG_CORRECTIONS`, or `BEIZHU_RULES`) to implement each decision, then re-run dry-run to see the updated category list. This cycle repeats until the resulting taxonomy is clean and intentional.

**Why this priority**: This is the core of the feature. Without curation, the migration would preserve the long tail of overly specific or inconsistent subcategories from the source data.

**Independent Test**: Make a single config change (e.g., add a `SUBCATEGORY_REMAP` entry to merge two subcategories). Re-run dry-run. Verify the merged subcategory now appears as one entry with combined frequency.

**Acceptance Scenarios**:

1. **Given** a `SUBCATEGORY_REMAP` entry mapping `補給` → `零食`, **When** dry-run runs, **Then** no `食:補給` entries appear in the category list — all those transactions are counted under `食:零食`.
2. **Given** a `TAG_CORRECTIONS` entry reclassifying `其他:Netflix` → `樂:Netflix`, **When** dry-run runs, **Then** `其他:Netflix` no longer appears in the category list and `樂:Netflix` frequency reflects the combined count.
3. **Given** multiple curation iterations, **When** each dry-run completes, **Then** the category list grows shorter and more consolidated — the total number of distinct `major:subcategory` pairs decreases toward the user's target taxonomy.

---

### User Story 3 — Write SQL Migration from Curated Taxonomy (Priority: P2)

Once the user is satisfied with the dry-run category list, they generate a SQL migration file (`012_legacy_categories.sql`) containing `INSERT … ON CONFLICT DO NOTHING` statements for every `(major, subcategory)` pair in the curated taxonomy that is not already in the `categories` table. This SQL is applied to the DB before the data migration runs.

**Why this priority**: The categories table must be complete before transactions are inserted, so the PWA category picker immediately offers all curated subcategories after migration.

**Independent Test**: Apply the SQL migration to the clean DB. Verify that every `major:subcategory` pair in the final dry-run category list has a corresponding row in the `categories` table. Run `migrate-legacy.ts` (live) — verify no "unknown category" warnings appear.

**Acceptance Scenarios**:

1. **Given** the final curated dry-run category list, **When** the SQL migration is applied, **Then** every `major:subcategory` in the list has a row in `categories` (verified by query).
2. **Given** major categories `其他` and `衣` which are not in the initial seed, **When** the SQL migration runs, **Then** their `(major, NULL)` rows are also inserted so the major itself is recognised.
3. **Given** the SQL migration has been applied and `migrate-legacy.ts` is run, **Then** all legacy transactions are inserted with tags that correspond to rows in the `categories` table.
4. **Given** the SQL migration is run twice, **Then** no duplicate rows are created and no errors are raised.

---

### User Story 4 — Auto-Extend Categories on Future Migration Runs (Priority: P3)

If the migration script is ever re-run (e.g., with an updated CSV export or revised config), it automatically upserts any `major:subcategory` pair it encounters into the `categories` table before inserting transactions. No manual SQL step is required for supplemental runs.

**Why this priority**: Future-proofing. The curation workflow today produces a clean SQL migration; this ensures subsequent runs remain self-contained without requiring a separate SQL file.

**Independent Test**: Add a new `TAG_CORRECTIONS` entry that produces a previously unseen `major:subcategory`. Run the script (non-dry-run). Verify the new category row appears in the table before any transaction is inserted.

**Acceptance Scenarios**:

1. **Given** a config change that produces a new `major:subcategory` not in the categories table, **When** the script runs, **Then** that category row is upserted before the corresponding transaction is written.
2. **Given** `--dry-run` mode with a new subcategory, **Then** the dry-run report lists it under "would create categories" — no DB writes occur.
3. **Given** a category already in the table, **When** the script encounters it, **Then** no duplicate row is created.

---

### Edge Cases

- What if a `SUBCATEGORY_REMAP` or `TAG_CORRECTIONS` change causes a previously seen subcategory to disappear entirely from the output? → It simply won't appear in the SQL migration; the categories table won't have a row for it — which is correct and intentional.
- What if the user wants to delete a subcategory from the categories table after adding it? → Out of scope for the migration script; handled directly via DB administration.
- What if two config entries produce conflicting tags for the same row? → The existing parser resolution order (`TAG_CORRECTIONS` applied last, overriding earlier tags) remains unchanged; dry-run output makes conflicts visible.
- What if a major category (e.g., `衣`) has no `(major, NULL)` row in the seed? → The SQL migration must include it. The script and SQL authoring must both check for missing major-level rows.
- What if sort_order for new categories is not explicitly set? → New entries append after existing entries for the same major, using the next available multiple of 10. Within a newly added block, order follows descending frequency from the dry-run output.

---

## Requirements

### Functional Requirements

- **FR-001**: The dry-run output of `migrate-legacy.ts` MUST include a category frequency table: every unique `major:subcategory` pair the parser would assign, sorted by transaction count descending, with the count displayed.
- **FR-002**: Tags that do not follow the `major:subcategory` format (plain store names, free tags without `:`) MUST be excluded from the category frequency table.
- **FR-003**: A database migration SQL file MUST be produced (manually or via a helper script) containing `INSERT … ON CONFLICT DO NOTHING` for every `(major, subcategory)` pair in the final curated taxonomy not already in the `categories` table. Missing `(major, NULL)` rows for new major categories MUST also be included.
- **FR-004**: The SQL migration MUST be idempotent — safe to run multiple times without producing errors or duplicate rows.
- **FR-005**: The SQL migration MUST be applied to the DB before `migrate-legacy.ts` is run in live mode.
- **FR-006**: The `migrate-legacy.ts` script MUST be updated to upsert any `major:subcategory` pair it encounters into the `categories` table prior to inserting the corresponding transactions, using `ON CONFLICT DO NOTHING`. This applies to both live runs and re-runs.
- **FR-007**: In `--dry-run` mode, the script MUST report any `(major, subcategory)` pairs it *would* create in the categories table, without performing any DB writes.
- **FR-008**: The PWA category picker will automatically reflect the extended categories table after the SQL migration is applied — no frontend code change is required.
- **FR-009**: The PWA summary drilldown correctly groups legacy transactions by their tag's `major:subcategory` regardless of categories table contents — no code change is required; this is already satisfied by the existing implementation.

### Key Entities

- **categories**: The authoritative taxonomy table. Each row is a `(major, subcategory)` pair with `sort_order` and a unique constraint `NULLS NOT DISTINCT`. A `(major, NULL)` row represents the major category itself.
- **Parser config**: `BEIZHU_RULES`, `TAG_CORRECTIONS`, `SUBCATEGORY_REMAP` in `legacy-csv-config.ts` — the rules layer that maps raw CSV values to final `major:subcategory` tags. Updated during curation.
- **Category inventory**: The deduplicated frequency table produced by `--dry-run`. The primary artefact for curation decisions.
- **SQL migration** (`012_legacy_categories.sql`): The output of the curation process — extends the categories table with the curated taxonomy before the data migration runs.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: The dry-run category inventory lists every unique `major:subcategory` the parser would assign, with frequency counts, with zero entries missing from the list.
- **SC-002**: After curation, the total number of distinct `major:subcategory` pairs in the inventory is reduced to a number the user considers clean and intentional (user-defined target; baseline is the pre-curation count from first dry-run).
- **SC-003**: After the SQL migration and data migration both run, 100% of unique `major:subcategory` tags on legacy transactions have a corresponding row in the `categories` table — zero unmatched categories.
- **SC-004**: The PWA category picker for major `其他` lists subcategories after migration (vs. 0 before, since `其他` is not in the initial seed).
- **SC-005**: Re-running the SQL migration twice produces identical DB state — no duplicate rows, no errors.
- **SC-006**: Re-running `migrate-legacy.ts` after the first successful import produces zero new transaction inserts (dedup) and zero new category inserts (all already present).

---

## Assumptions

- The DB is in a clean state: the `categories` table is seeded (migration 011), and the transactions table is empty. The correct execution order is: curation → SQL migration → `migrate-legacy.ts`.
- The original NaggingMoney CSV file is available locally for dry-run analysis during the curation phase.
- Curation decisions are implemented by modifying `SUBCATEGORY_REMAP`, `TAG_CORRECTIONS`, and/or `BEIZHU_RULES` in `legacy-csv-config.ts`. The parser logic itself (`legacy-csv-parser.ts`) is not expected to change.
- The categories table's unique constraint (`UNIQUE NULLS NOT DISTINCT (major, subcategory)`) guarantees idempotency for `INSERT … ON CONFLICT DO NOTHING`.
- The PWA category picker reads from the `categories` table dynamically; extending the table is sufficient to update the picker. No frontend code change is required.
- The PWA summary parses tag strings directly and does not query the `categories` table; summary display is correct regardless of table contents.
- `sort_order` for new categories appends after existing entries for the same major using the next available multiple of 10, with descending frequency ordering within newly added blocks.
- The existing categories in the `categories` table (added by migration 011) are correct and will not be modified; only new rows are appended.
