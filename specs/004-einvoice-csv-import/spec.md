# Feature Specification: E-Invoice CSV Auto-Import

**Feature Branch**: `004-einvoice-csv-import`
**Created**: 2026-05-09
**Status**: Draft
**Input**: MOF API access blocked for individuals; pivot from real-time invoice matching to periodic user-driven CSV import with full backend parsing and automation.

---

## Background

The original plan to reconcile transactions with Taiwan's e-invoice system via the government API is no longer viable — the API requires institutional approval and the scraping alternative is disproportionately complex. Since automatic invoice retrieval is off the table, the Android notification collection pipeline loses its primary value proposition (collecting partial transaction records that could never be enriched automatically).

The pivot: the user manually downloads their e-invoice history as a CSV from the government's e-invoice portal at whatever cadence works for them, and a backend service handles the rest — parsing, matching against existing transactions, filling in merchant details, and creating new records for any spending that was never manually entered.

This spec also captures the broader automation opportunities that remain available within this constraint: reducing the number of things a user must remember or type, without requiring real-time system access.

---

## User Scenarios & Testing

### User Story 1 — Upload CSV and Enrich Existing Transactions (Priority: P1)

The user downloads their e-invoice history CSV from the government portal (covering roughly the last 1–2 months) and sends it to the Discord bot as a file attachment with a `/import` command. The system parses each invoice, finds the matching transaction records by amount and date, and fills in merchant name, invoice number, and any itemized line items that the CSV provides. The user receives a summary of how many transactions were enriched.

**Why this priority**: This is the core value delivery — replacing the MOF API pipeline with a user-driven equivalent. Every enriched transaction means one fewer record the user has to annotate manually.

**Independent Test**: Upload a CSV containing 5 invoices, each with a corresponding transaction already recorded in the database with matching amount and approximate date. Verify all 5 transactions now have `seller_name`, `invoice_number`, and `is_matched = true` populated. Verify no duplicate invoice records are created on a second upload of the same file.

**Acceptance Scenarios**:

1. **Given** a transaction for NT$180 recorded on 05/03, **When** the CSV contains an invoice for NT$180 from the same merchant dated 05/03, **Then** the transaction is marked matched with the merchant name and invoice number filled in.
2. **Given** an invoice in the CSV matches two transactions of the same amount on the same day, **When** the CSV is imported, **Then** the system matches the most recently recorded transaction and flags the ambiguity in the import summary.
3. **Given** the user uploads the same CSV a second time, **When** the import runs, **Then** already-imported invoices are skipped and the summary shows "0 new, X already imported".
4. **Given** an invoice amount is NT$1,500 but no transaction within ±2 days matches, **When** the CSV is imported, **Then** the invoice is held as unmatched and surfaced in the import summary.

---

### User Story 2 — Discover Missed Transactions from Invoice History (Priority: P1)

Some purchases are never manually entered — the user forgot, was in a rush, or simply didn't notice. When the CSV is imported and an invoice has no matching transaction, the system creates a new transaction record using the invoice data (merchant, amount, date, items if available) and uses AI to infer category and payment method.

**Why this priority**: Memory failure is the primary source of bookkeeping gaps. This is the single highest-leverage automation available — it recovers spending the user would otherwise never record.

**Independent Test**: Import a CSV containing 3 invoices with no existing transaction records. Verify 3 new transactions are created with `transaction_type = 'expense'`, populated merchant names, and AI-inferred tags. Verify these appear in the monthly budget total.

**Acceptance Scenarios**:

1. **Given** a CSV invoice for NT$320 at a restaurant with no matching transaction, **When** imported, **Then** a new expense transaction is created with the merchant name, amount, and date from the invoice, and Gemini infers appropriate tags (e.g., "food").
2. **Given** a CSV invoice includes itemized line items (商品明細), **When** imported, **Then** the new transaction's `items` field is populated from those line items.
3. **Given** the same unmatched invoice is present in two consecutive CSV uploads, **When** the second CSV is imported, **Then** no duplicate transaction is created (deduplication by invoice number).
4. **Given** the user disagrees with an auto-created transaction, **When** they edit or delete it through the normal Discord commands, **Then** the invoice record remains but the transaction link is cleared.

---

### User Story 3 — Import Summary and Spending Audit (Priority: P2)

After each CSV upload, the bot replies with a structured summary: how many invoices were processed, how many matched existing transactions, how many created new records, and how many existing transactions from the same period still have no invoice (likely cash payments, foreign purchases, or subscriptions without TW invoices).

**Why this priority**: Without visibility into what was and wasn't matched, the user can't trust the completeness of their records. This also closes the feedback loop — the user knows when to manually record cash transactions or flag unusual gaps.

**Independent Test**: Import a CSV covering a 30-day period that contains 8 invoices. 5 match existing transactions. 2 create new records. 3 existing transactions in that same period have no matching invoice. Verify the summary reports exactly these counts and lists the unmatched transactions by amount and date.

**Acceptance Scenarios**:

1. **Given** an import completes, **When** the user reads the summary, **Then** it shows: matched count, new records created, and a list of transactions in the CSV date range that still have no invoice.
2. **Given** all transactions in the period have matching invoices, **When** the import completes, **Then** the summary confirms "全部對齊" (fully reconciled) with no outstanding gaps.
3. **Given** the import encounters a malformed row in the CSV, **When** parsing that row fails, **Then** the rest of the file continues processing and the summary notes the skipped row.

---

### User Story 4 — Periodic Download Reminder (Priority: P3)

Because Taiwan's e-invoice lottery finalises 2 months after purchase, invoice data for a given month becomes complete roughly 2 months later. The bot sends the user a Discord reminder every 2 months prompting them to download and upload their latest invoice history, so no invoices fall through the cracks.

**Why this priority**: The CSV import is only valuable if the user actually does it. A periodic reminder closes the habit loop without requiring the user to remember an arbitrary schedule.

**Independent Test**: Configure the reminder schedule. Verify a Discord message is sent at the scheduled time containing a reminder to download the CSV, with a note on which time period to cover.

**Acceptance Scenarios**:

1. **Given** the reminder is enabled, **When** 2 months have passed since the last scheduled reminder, **Then** the bot sends a Discord message reminding the user to download and upload their invoice CSV for the past 2 months.
2. **Given** the user just completed an import, **When** the reminder fires, **Then** it notes the date of the last import so the user knows their coverage.

---

### Edge Cases

- CSV contains invoices older than 12 months: import them normally (no cutoff), but note the age in the summary.
- CSV encoding is not UTF-8 (Big5 is common for Taiwanese government exports): system must handle both encodings gracefully.
- Invoice amount is zero (cancelled or voided invoice): skip or create a zero-amount record; do not count as a match.
- Transaction recorded as `fee` or `refund` type is never a match target — only `expense` transactions are candidates for invoice matching.
- Very large CSV (e.g., 500+ invoices covering 6 months): processing must not time out; process in batches if needed.
- Partial itemized data: some CSV exports include merchant name but no line items — accept partial data rather than rejecting the row.

---

## Requirements

### Functional Requirements

- **FR-001**: The system MUST accept a CSV file attachment via Discord `/import` command and parse it into invoice records.
- **FR-002**: The system MUST handle both UTF-8 and Big5 encoded CSV files from the government portal.
- **FR-003**: The system MUST match each parsed invoice against existing `expense`-type transactions within a ±2-day date window and exact amount match.
- **FR-004**: For each matched pair, the system MUST update the transaction with `seller_name`, `invoice_number`, `is_matched = true`, and itemized line items if available in the CSV.
- **FR-005**: Invoices that match by amount and date but have multiple candidate transactions MUST match the most recently created transaction and flag the ambiguity in the import summary.
- **FR-006**: For each unmatched invoice (no existing transaction), the system MUST create a new `expense` transaction using the invoice data, with AI-inferred tags and payment method.
- **FR-007**: The system MUST deduplicate by invoice number — re-importing the same invoice MUST NOT create duplicate transactions or update already-matched records.
- **FR-008**: After each import, the system MUST reply with a structured summary: matched count, new records created, skipped (duplicate) count, and any existing transactions in the CSV date range with no invoice.
- **FR-009**: The system MUST continue processing the rest of the CSV if any individual row fails to parse; failed rows MUST be noted in the summary.
- **FR-010**: The system MUST send a Discord reminder message every 2 months prompting the user to download and upload their invoice CSV, noting the recommended coverage period.

### Key Entities

- **Invoice**: A record from the government CSV. Key attributes: invoice number, seller name, seller tax ID, invoice date, total amount, line items (optional), carrier type. Matched to at most one transaction.
- **Transaction** (existing): Extended with `invoice_number` (string), `is_matched` (boolean), `seller_name` (string). Already exists in the schema; this feature populates these fields via CSV import.
- **Import Run**: A record of a single CSV upload. Attributes: upload timestamp, file name, total rows parsed, matched count, new transactions created, skipped (duplicate) count, unmatched transaction list.

---

## Success Criteria

- **SC-001**: A CSV upload containing 20 invoices completes processing and the user sees the import summary within 30 seconds.
- **SC-002**: At least 90% of invoices in the CSV are correctly matched to existing transactions when amount and date are identical.
- **SC-003**: Re-uploading the same CSV produces 0 new records and 0 duplicate matches — idempotent at invoice-number level.
- **SC-004**: The periodic reminder is sent within 1 hour of its scheduled trigger time.
- **SC-005**: Missing transactions discovered via CSV (US2) reduce the gap between total invoice spending and manually recorded spending to under 5% for any given month.

---

## Automation Opportunities (Brainstorm)

Beyond this spec, other automation ideas worth evaluating in future specs:

1. **Bank/credit card statement import**: Many TW banks allow CSV export of account statements. Importing bank CSV could catch expenses that don't generate TW e-invoices: foreign transactions, service fees, utility bills, online subscriptions. This would complement the invoice CSV by covering a different spending category.

2. **Subscription pattern detection**: If the same amount appears from the same merchant every 30 days (e.g., streaming services, cloud storage), the system could prompt "this looks like a subscription — should I auto-record it monthly?" — reducing manual entries to zero for predictable recurring charges.

3. **Spending gap alerts**: If the current month reaches 80%+ of budget faster than the historical average pace, the bot sends a heads-up — proactive rather than retrospective.

4. **Zero-friction confirmation**: For transactions that have a 1:1 invoice match with identical amount, merchant, and date, auto-approve without showing a prompt — only surface ambiguous or new transactions for review.

---

## Assumptions

- The user downloads CSV from Taiwan's government e-invoice portal (einvoice.nat.gov.tw) using their existing mobile barcode or natural person certificate login — the download step is always manual.
- The CSV format follows the standard government export schema; the system does not need to handle third-party CSV formats.
- Invoice data becomes reliable approximately 2 months after purchase (lottery settlement period); the reminder cadence is set to 2 months accordingly.
- Only `expense`-type transactions are invoice-match candidates. `fee` and `refund` transactions are never matched to invoices.
- The matching window is ±2 days by default (same as the existing receipt-matching logic in the codebase).
- AI-assisted categorisation for new transactions (US2) uses the existing Gemini integration.
- The upload interface is the existing Discord bot — no separate web UI is required for this feature.
- An "import run" record is stored for audit purposes but does not need a dedicated UI view; the Discord summary message is the primary interface.
