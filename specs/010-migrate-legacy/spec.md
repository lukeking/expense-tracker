# Feature Specification: Legacy Accounting Data Migration

**Feature Branch**: `010-migrate-legacy`
**Created**: 2026-05-16
**Status**: Draft
**Input**: One-time import of 10+ years of NaggingMoney expense history into the current expense tracker, preserving all historical records with appropriate category mapping and deduplication.

---

## Background

The user has 10+ years of expense history recorded in NaggingMoney, a Taiwanese mobile accounting app. The export is a single UTF-8 CSV (`NaggingMoney_YYYYMMDD_utf8.csv`) with ~17,000 rows covering 2016 onward. This data needs to be imported into the current expense tracker as the definitive historical baseline before the new system becomes the primary record-keeper.

The migration is a one-time local operation — no Discord bot involvement, no cloud infrastructure. The primary challenge is faithfully converting NaggingMoney's category taxonomy and item description format into the current system's schema, while skipping non-transaction rows and avoiding duplicates on re-runs.

---

## User Scenarios & Testing

### User Story 1 — Run Migration and Load All Historical Expenses (Priority: P1)

The user runs a local migration script against the NaggingMoney CSV. The script reads all expense and income rows, maps categories to the current system's taxonomy, converts the item description into a transaction description, and inserts them into the database. A summary is printed to the terminal showing how many records were processed, imported, skipped (non-transaction rows), and any rows that could not be mapped.

**Why this priority**: Without this, there is no historical record in the new system. Everything else in the migration depends on this core import working correctly.

**Independent Test**: Run the script against the full export CSV. Verify the database contains the expected number of expense and income records. Verify at least one record per legacy category is present. Verify the total expense amount across all imported records matches a manual sum of the source CSV.

**Acceptance Scenarios**:

1. **Given** the NaggingMoney CSV with ~15,200 expense rows and ~6 income rows, **When** the migration runs, **Then** all expense and income rows are imported as transactions and the terminal shows an accurate summary of processed/skipped/failed counts.
2. **Given** a row with type `99` (daily balance marker), **When** the migration processes it, **Then** it is silently skipped and counted in the "skipped" total, not imported as a transaction.
3. **Given** a row with an unmapped category value, **When** the migration processes it, **Then** the row is imported with a fallback category (or flagged in the summary) rather than silently dropped.
4. **Given** the user re-runs the migration after fixing a mapping error, **When** the script runs again, **Then** no duplicate records are created — previously imported rows are detected and skipped.

---

### User Story 2 — Category Mapping from NaggingMoney Taxonomy (Priority: P1)

NaggingMoney uses single-character Chinese category codes (食, 行, 他, 店, 醫, 住, 衣, 樂, 育). The migration maps these to the current system's category+subcategory structure. The item description field often encodes a subcategory using a `)` separator (e.g., `飲料)紅茶拿鐵` → subcategory: `飲料`, description: `紅茶拿鐵`).

**Why this priority**: Correct categorisation is the primary analytical value of historical data. Bulk imports with wrong categories cannot be easily corrected after the fact.

**Independent Test**: Import a hand-curated sample of 20 rows covering all 9 legacy categories and several subcategory `)` patterns. Verify each resulting transaction has the correct mapped category, subcategory, and description.

**Acceptance Scenarios**:

1. **Given** a row with category `食` and item `飲料)紅茶拿鐵`, **When** imported, **Then** the transaction has category `food` (or equivalent), subcategory `飲料`, and description `紅茶拿鐵`.
2. **Given** a row with item `早餐` (no `)` separator), **When** imported, **Then** the transaction description is `早餐` with no subcategory extracted.
3. **Given** a row with category `醫` (medical), **When** imported, **Then** the transaction is mapped to the appropriate current-system category for health/medical spending.
4. **Given** a row where the legacy category has no direct equivalent, **When** imported, **Then** the transaction receives a designated "uncategorised" category and the mapping gap is noted in the summary.

---

### User Story 3 — Payment Method Inference from Account Field (Priority: P2)

NaggingMoney records which account was debited (`支出帳戶`) or credited (`收入帳戶`). Common values include `現金` (cash) and possibly card names. The migration maps known account values to the current system's payment method taxonomy.

**Why this priority**: Payment method data is present in the source and worth preserving; losing it permanently would require manual re-annotation of thousands of records.

**Independent Test**: Import a sample of rows with `支出帳戶 = 現金` and rows where the account field is empty. Verify the `現金` rows have `payment_method = cash` and empty-account rows receive a sensible default.

**Acceptance Scenarios**:

1. **Given** a row with `支出帳戶 = 現金`, **When** imported, **Then** the transaction has `payment_method = cash`.
2. **Given** a row where `支出帳戶` is empty, **When** imported, **Then** the transaction receives a configurable default payment method (e.g., `cash`).
3. **Given** an account value that does not match any known mapping, **When** imported, **Then** it is logged in the summary as an unmapped account value, and a default is applied.

---

### User Story 4 — Dry Run and Validation Preview (Priority: P2)

Before committing any records to the database, the user can run the script in dry-run mode to preview what will be imported: total row count, category mapping coverage, any unmapped values, and a sample of output records. No database writes occur in this mode. The full preview is written to a timestamped output file for careful review, with a brief summary printed to the terminal.

**Why this priority**: With 17,000 rows, it is critical to catch mapping errors before they are committed. A dry-run prevents importing thousands of misclassified records. Writing to a file (rather than pure console output) allows the user to scroll, search, and compare across multiple dry-run iterations.

**Independent Test**: Run the script in dry-run mode against the full CSV. Verify no records appear in the database afterward. Verify a preview file is created containing row counts, category coverage %, and at least 5 sample output rows. Verify the terminal shows only a brief summary pointing to the file.

**Acceptance Scenarios**:

1. **Given** the script is run with a `--dry-run` flag, **When** it completes, **Then** zero records are written to the database, a preview file is written to disk, and the terminal prints a one-line summary (e.g., "Dry run complete — see dry-run-YYYYMMDD-HHMMSS.txt").
2. **Given** the dry-run preview file shows unmapped categories, **When** the user updates the mapping configuration and re-runs dry-run, **Then** a new preview file is created reflecting the updated mappings, and the previous file is preserved for comparison.
3. **Given** multiple dry runs are performed, **When** each completes, **Then** each produces a distinct timestamped file — no previous dry-run output is overwritten.

---

### Edge Cases

- What happens when the same row appears in two separate CSV exports (e.g., overlapping date ranges)? → Deduplication by `(amount, transaction_at, description)` hash prevents double-import.
- What happens when the amount field contains non-numeric characters (e.g., leading "NT" or "NT$")? → Strip currency prefixes before parsing; log any row where parsing fails.
- What happens when the date field is malformed or missing? → Skip the row and include it in the failure count; do not silently default to today's date.
- What happens when the item field is empty? → Import the transaction with an empty description; do not block the row.
- What happens when `貨幣` is not `TWD`? → Flag the row in the summary; import with the original currency value recorded but highlighted for user review.

---

## Requirements

### Functional Requirements

- **FR-001**: The migration script MUST read the NaggingMoney UTF-8 CSV format with columns: `日期, 類型, 支出帳戶, 收入帳戶, 分類, 項目, 金額, 貨幣, 發票號碼, 備註, 標籤`.
- **FR-002**: Rows with type `99` MUST be skipped and counted separately; they are not transactions.
- **FR-003**: The script MUST map all 9 known legacy categories (食, 行, 他, 店, 醫, 住, 衣, 樂, 育) to the current system's category taxonomy. The mapping MUST be defined in a configuration file, not hardcoded.
- **FR-004**: The script MUST parse item descriptions containing `)` as a subcategory separator: the text before `)` becomes the subcategory and the text after becomes the transaction description.
- **FR-005**: All imported records MUST be tagged with `source: 'legacy_migration'` to distinguish them from manually entered transactions.
- **FR-006**: The script MUST deduplicate by a hash of `(amount, transaction_at, description)` — rows already present in the database under `source: 'legacy_migration'` MUST be skipped on re-run.
- **FR-007**: The script MUST support a `--dry-run` flag that processes the entire CSV without writing to the database. It MUST write the full preview (row counts, category coverage, unmapped values, sample output records) to a timestamped file (e.g., `dry-run-YYYYMMDD-HHMMSS.txt`). The terminal MUST print only a brief summary line pointing to that file. Each dry-run MUST produce a new file; previous files MUST NOT be overwritten.
- **FR-008**: The script MUST process records in batches (configurable, default 100) to avoid memory or connection issues with large files. Within a batch, a write failure for one row MUST NOT roll back the rest — the failed row is skipped, logged to the failure count, and the remaining rows in the batch are committed.
- **FR-009**: The script MUST print a terminal summary on completion: total rows read, imported, skipped (type-99), deduplicated (already imported), and failed (parse errors).
- **FR-010**: Rows with type `支出` MUST be imported as `expense` transactions; rows with type `收入` MUST be imported as `income` transactions.
- **FR-011**: Rows where amount parsing fails (non-numeric after prefix stripping) MUST be skipped and counted in the failure total, not silently zeroed.
- **FR-012**: The script MUST accept the CSV file path as a command-line argument.
- **FR-013**: The source `備註` field MUST be mapped to the current system's tags field. The source `標籤` field MUST be ignored.

### Key Entities

- **LegacyTransaction**: A single row from the NaggingMoney CSV representing an expense or income event. Key attributes: date, type (expense/income), debit account, credit account, category, item description, amount, currency, invoice number, note, tag.
- **Transaction**: The target entity in the current system. Receives: `transaction_at`, `transaction_type`, `amount`, `description`, `category`, `subcategory`, `payment_method`, `source`, and `tags` (populated from the source `備註` field).
- **CategoryMapping**: Configuration artifact mapping legacy single-character category codes to current-system category + default subcategory values.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: All 15,200+ expense rows and 6 income rows from the source CSV are importable without manual row-by-row intervention.
- **SC-002**: 100% of the 9 known legacy categories are mapped before the first production run — zero "unmapped category" failures on the known dataset.
- **SC-003**: Running the migration twice against the same CSV produces the same number of records in the database as running it once — no duplicates introduced on re-run.
- **SC-004**: The dry-run completes and writes a full preview file in under 60 seconds on the full 17,000-row CSV.
- **SC-005**: The total imported expense amount (sum of all `amount` values for `source = 'legacy_migration'`) matches the sum of the `金額` column in the source CSV to within rounding error.

---

## Clarifications

### Session 2026-05-16

- Q: Should there be a staging checkpoint (write to a scratch area first, review, then promote) or is `--dry-run` sufficient to vet quality before committing? → A: No staging table — `--dry-run` is sufficient. However, dry-run output MUST be written to a timestamped file (not just console) so the user can review, search, and compare across iterations.
- Q: When a single row in a batch fails to write, what should happen to the other rows in that batch? → A: Skip and log the failed row; commit the rest of the batch. A full batch rollback is unnecessary given dedup-safe re-runs.
- Q: Should `備註` and/or `標籤` be stored on the imported transaction? → A: Map `備註` → tags field. Ignore the source `標籤` column entirely (only 2 non-empty rows in the full dataset).

---

## Assumptions

- The source CSV is the single `NaggingMoney_20260516082424_utf8.csv` file already present in the project root. There is only one export to import; this is not a recurring operation.
- All amounts are in TWD; non-TWD rows (if any) are edge cases to flag, not a primary use case.
- The migration runs locally by the developer; there is no Discord interface, no web UI, and no scheduled trigger.
- Invoice numbers in the legacy data (`發票號碼` column) are ignored — historical records were manually reconciled at the time and do not need retroactive e-invoice linking.
- The `備註` (note) column is mapped to the current system's tags field — its free-text content becomes the tag value for the imported transaction. The `標籤` (tag) column in the source CSV is ignored (only 2 non-empty rows across the entire dataset).
- The current system's category taxonomy is considered authoritative; the legacy categories are mapped to fit it, not the reverse.
- No Gemini/AI tag inference pass is required for the initial migration run; the category mapping configuration is sufficient. AI inference can be added as a future enhancement if mapping gaps are found post-import.
- Payment method defaults to `cash` for any row where `支出帳戶` / `收入帳戶` is empty or unrecognised.
