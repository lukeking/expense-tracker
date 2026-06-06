# Feature Specification: Invoice Import Batching (subrequest-safe matching)

**Feature Branch**: `024-invoice-import-batching`
**Created**: 2026-06-06
**Status**: Draft
**Input**: User description: "Invoice import fails in production on Cloudflare Workers with 'Too many subrequests by single Worker invocation'. The import pipeline issues several data-store queries per invoice, so the total round-trips grow with the number of invoices and exceed the platform's per-invocation subrequest cap. Make a single import stay under the cap regardless of CSV size, while preserving the exact current matching behavior. Realizes the performance optimisation deferred in spec 022."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Import completes regardless of CSV size (Priority: P1)

The user uploads a normal monthly government e-invoice CSV export through the PWA Import screen. The import runs to completion and shows the post-import summary — it does **not** fail partway with a platform "too many subrequests" error, no matter how many invoices the file contains (up to the existing 1000-row cap).

**Why this priority**: This is the bug. Today an import of a real-sized CSV aborts with `findMatchingExpenseTransaction discounts: Too many subrequests by single Worker invocation`, leaving the user with no way to import and a partially-written database. Restoring a reliable import is the entire point of the feature.

**Independent Test**: Upload a CSV large enough to previously trip the cap; confirm the import finishes and returns a complete summary covering 100% of the invoices in the file.

**Acceptance Scenarios**:

1. **Given** a CSV that previously failed with the subrequest error, **When** the user uploads it, **Then** the import completes and the summary accounts for every invoice across the outcome buckets (matched / ambiguous / skipped).
2. **Given** a CSV at the 1000-row hard cap, **When** the user uploads it, **Then** the import completes within the platform's per-invocation limits without a subrequest or wall-time error.
3. **Given** an empty CSV or one containing only already-imported invoice numbers, **When** the user uploads it, **Then** the import completes immediately with the correct duplicate/zero counts and no error.

---

### User Story 2 - Matching results are unchanged (Priority: P1)

For any given CSV and database state, the set of invoices that auto-link (and at what confidence), that are held ambiguous, and that are skipped is **identical** to the behavior before this change. The optimisation is invisible in outcomes — it only changes how the work is performed internally.

**Why this priority**: A performance refactor that silently changes which invoices match (or mis-links a transaction) would corrupt financial records with no undo at import time. Behavior preservation is as critical as the fix itself, so it shares P1.

**Independent Test**: Run the existing backend matching/pipeline test suite unchanged; all matching-outcome assertions still pass. Spot-check a real import: the matched/ambiguous/skipped breakdown equals what the prior implementation produced for the same inputs.

**Acceptance Scenarios**:

1. **Given** an invoice with exactly one in-window transaction whose paid amount (or paid + recorded discounts) equals the invoice net, **When** the import runs, **Then** that invoice auto-links with the same exact/near confidence as before.
2. **Given** an invoice with two or more qualifying in-window candidates, **When** the import runs, **Then** the invoice is held `ambiguous` (never auto-linked).
3. **Given** an invoice with zero exact/discount candidates but a forex candidate within the wider window, **When** the import runs, **Then** the invoice is held `ambiguous` and is never auto-linked.
4. **Given** an invoice with no candidate of any kind, **When** the import runs, **Then** it is counted `skipped_unmatched` and **no** invoice row is persisted (unchanged from FR-007).
5. **Given** two invoices in the same import that could each match the same single transaction, **When** the import runs, **Then** the transaction links to only one of them and the other falls through to its next outcome (forex/ambiguous or skipped) exactly as it would have when each invoice was processed sequentially against the live database.

---

### Edge Cases

- **Same transaction, two invoices, one run**: a transaction consumed (linked) earlier in the run must not be offered as a candidate to a later invoice in the same run — preserving the sequential "already linked → excluded" behavior without re-querying the database per invoice.
- **Wide date span**: a CSV whose invoices span many months produces a wide candidate-fetch window. The number of unmatched in-window transactions is assumed to stay within the data store's single-response row limit; if a window could exceed it, the fetch must page through results rather than silently truncate (a truncated read would drop real candidates and change matching outcomes).
- **No candidates to fetch**: when every invoice is a duplicate (or the file is empty), the pipeline performs no candidate reads and still returns a correct summary.
- **Partial-failure semantics**: if the invocation still fails for an unrelated reason, the existing recoverability characteristics (status flips ordered so a re-import can safely retry) are not made worse by this change.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A single import invocation MUST keep its total data-store round-trips bounded so that it stays within the hosting platform's per-invocation subrequest limit for any CSV up to the existing 1000-row cap.
- **FR-002**: The number of candidate-lookup round-trips MUST NOT scale linearly with the number of invoices. Candidate transactions and their discount adjustments MUST be fetched in a bounded number of queries for the whole import, not one (or more) per invoice.
- **FR-003**: Matching MUST be performed against the pre-fetched candidate set in memory, producing the same exact / near / ambiguous / forex-ambiguous / skipped_unmatched classifications the per-invoice implementation produced for the same inputs.
- **FR-004**: The candidate fetch window MUST be wide enough to cover every matching rule in use — at minimum the ±2-day exact/discount window and the ±7-day forex window — computed once across all invoices in the import (earliest invoice date minus the widest look-back through latest invoice date plus the widest look-ahead).
- **FR-005**: Within a single import run, a transaction that has been linked to one invoice MUST NOT be eligible to match a later invoice in the same run (no double-linking), matching the prior behavior where the database `matched` filter excluded already-linked transactions.
- **FR-006**: The pipeline MUST remain enrichment-only: it MUST NOT create any new transaction under any circumstance.
- **FR-007**: Invoices with zero candidates MUST continue to be counted as `skipped_unmatched` with **no** invoice row persisted, so a later import can retry them once a matching transaction exists.
- **FR-008**: The write side (invoice inserts, transaction enrichment, transaction-item fills) MUST NOT reintroduce per-invoice round-trip growth that would breach the subrequest limit; writes MUST be batched or otherwise bounded so they scale safely within the cap for the linked/ambiguous subset of an import.
- **FR-009**: The post-import summary MUST continue to account for 100% of parsed invoices across all outcome buckets (matched + ambiguous + skipped = total parsed), unchanged in shape from the current response.
- **FR-010**: The feature MUST require no change to the import API contract and no database schema change — it is an internal change to how matching and writing are performed.
- **FR-011**: The existing 1000-row hard import cap MUST remain enforced at parse time before any writes.

### Key Entities *(include if feature involves data)*

- **Invoice (parsed)**: a single government e-invoice with its net amount, date, seller, and line items; classified during import into matched / ambiguous / skipped.
- **Candidate transaction**: an unmatched expense transaction within the import's date window, eligible to be linked to an invoice by exact amount, by paid-amount-plus-recorded-discounts, or as a forex near-amount candidate.
- **Discount adjustment**: a recorded `discount`-kind adjustment on a transaction that raises its effective gross for matching purposes; pre-fetched alongside candidate transactions.
- **Import run**: one upload/processing pass; owns the in-memory set of consumed (already-linked) transactions for the duration of the run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An import of a CSV that previously failed with the subrequest error now completes successfully and returns a full summary.
- **SC-002**: Candidate-lookup round-trips per import are a small constant (independent of invoice count) rather than growing with the number of invoices.
- **SC-003**: For every input in the existing matching/pipeline test suite, the matched / ambiguous / skipped outcomes and confidences are identical to the pre-change implementation (zero behavioral diffs).
- **SC-004**: A real production import at realistic volume completes within the platform's per-invocation subrequest and wall-time limits, with margin to spare at the 1000-row cap.
- **SC-005**: No transaction is linked to more than one invoice within a single import run.

## Assumptions

- The matching rules themselves (±2-day exact/discount window, ±7-day ±5% forex window, exact-vs-near confidence, ambiguous on ≥2 candidates, discounts-only gross adjustment) are correct and stay as-is; this feature only changes *how* the data backing those rules is fetched and written, not the rules.
- The existing backend test suite is the regression oracle for behavior preservation; "identical outcomes" is verified against it plus a manual real-import spot check.
- Within a single import's date window, the count of unmatched in-window expense transactions is normally well below the data store's single-response row limit (monthly cadence, small personal dataset); ranged/paged fetching is only needed if that assumption is violated and is called out as an edge case rather than a default.
- No API contract change and no database migration are required; this is a backend-only refactor (the deferred "performance optimisation for large CSVs" item from spec 022).
- The 100-invoice processing chunk that exists today for wall-time safety may be retained, removed, or repurposed as an implementation detail, provided the subrequest and wall-time guarantees in the Success Criteria still hold.
