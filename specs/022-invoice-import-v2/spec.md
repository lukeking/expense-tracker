# Feature Specification: Invoice Import v2 — Interactive Reconciliation

**Feature Branch**: `022-invoice-import-v2`
**Created**: 2026-05-31
**Status**: Draft

## Clarifications

### Session 2026-06-04

- Q: How should match confidence be labeled, given forex matches have a different amount than the invoice? → A: `exact` = same calendar day AND exact net amount; `near` = any other linked match. Forex matches are therefore always `near`.
- Q: Is the ±2-day window wide enough for foreign-currency purchases, whose card posting can lag the invoice date? → A: Keep ±2 days for exact-amount auto-link; use a wider ±7-day window for the forex fallback. Forex candidates are never auto-linked (manual resolution only), so the wider window adds options without risking wrong auto-links.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Upload CSV and Auto-Match Confident Invoices (Priority: P1)

The user uploads a government e-invoice CSV export. The system parses all invoices, skips any already imported (dedup by invoice number), then auto-links invoices where exactly one matching transaction exists. Matches made on the same calendar day as the invoice are marked exact; matches within ±2 days are marked near. No new transactions are created under any circumstance.

**Why this priority**: This is the core value — enriching existing transactions with official receipt data. Everything else depends on this working correctly.

**Independent Test**: Upload a CSV where every invoice has exactly one candidate transaction. Verify all invoices are linked to the correct transactions with the correct confidence level, and no new transactions were created.

**Acceptance Scenarios**:

1. **Given** a CSV with 10 invoices all having exactly one same-day candidate transaction, **When** the user uploads the file, **Then** all 10 are auto-linked as `exact`, items are filled/kept per the items rule, and no transactions are created.
2. **Given** a CSV where 3 invoices were already imported in a previous run, **When** the user re-uploads the same file, **Then** those 3 are silently skipped and the post-import summary shows `skipped_duplicate_count: 3`.
3. **Given** a CSV where one invoice has a single candidate transaction within ±2 days (not same-day), **When** the upload completes, **Then** the invoice is auto-linked and flagged as `near` confidence in the summary.
4. **Given** a CSV where one invoice has zero candidate transactions, **When** the upload completes, **Then** the invoice is skipped (no transaction created) and `skipped_unmatched_count` is incremented.

---

### User Story 2 — Resolve Ambiguous Invoices (Priority: P2)

After import, the user sees a list of invoices that had multiple candidate transactions and could not be auto-matched. For each ambiguous invoice, the user sees the invoice details alongside all candidate transactions and selects the correct one. The user also chooses whether to replace the transaction's existing items with invoice items or keep them.

**Why this priority**: Without resolution, ambiguous invoices are left unlinked and their items never enriched. This completes the reconciliation for the hard cases.

**Independent Test**: Import a CSV containing one invoice with two candidate transactions. Verify the invoice appears in the ambiguous list with both candidates shown. Select one candidate, confirm, and verify the invoice is linked and items are handled per the chosen option.

**Acceptance Scenarios**:

1. **Given** an invoice with 3 candidate transactions, **When** the user views the ambiguous list, **Then** all 3 candidates are shown with their date, amount, note, and existing items.
2. **Given** the user selects a candidate and chooses "keep items", **When** confirmed, **Then** the invoice is linked to that transaction and existing items are unchanged.
3. **Given** the user selects a candidate and chooses "replace items", **When** confirmed, **Then** existing items are replaced with positive-amount invoice line items only.
4. **Given** the user dismisses an ambiguous invoice without selecting, **Then** it remains unlinked with no changes to any transaction.

---

### User Story 3 — Post-Import Summary (Priority: P3)

After upload (and after each ambiguous resolution), the user sees a clear summary of what happened: how many invoices were matched, with what confidence, how many items were filled vs kept, how many were skipped as duplicates, unmatched, or ambiguous.

**Why this priority**: Gives the user visibility and confidence that the import did what they expected, without requiring them to manually inspect each transaction.

**Independent Test**: Import a mixed CSV (some matched, some ambiguous, some unmatched, some duplicates). Verify all counts in the summary are accurate.

**Acceptance Scenarios**:

1. **Given** a completed import, **When** the summary is shown, **Then** it displays: `matched_exact`, `matched_near`, `ambiguous`, `skipped_unmatched`, `skipped_duplicate`, `skipped_voided` counts.
2. **Given** matched invoices, **When** the summary lists them, **Then** each entry shows the seller name, invoice number, matched transaction date/amount, confidence level, and items outcome (filled / kept / count).
3. **Given** an ambiguous invoice is resolved, **When** the summary updates, **Then** the resolved invoice moves from the ambiguous list into the matched section.

---

### Edge Cases

- What happens when the CSV contains only already-imported invoice numbers? → Import completes immediately with `skipped_duplicate_count = N`, zero other activity.
- What happens when an invoice's net amount is zero (all items cancelled by discounts)? → Skipped and counted as `skipped_zero`.
- What happens when an invoice's date cannot be parsed? → Skipped silently, not counted in any user-visible bucket.
- What happens if the user re-uploads mid-resolution (some ambiguous already resolved)? → Dedup skips the already-resolved ones; remaining ambiguous re-appear.
- What if a candidate transaction already has a linked invoice? → Excluded from candidates so it cannot be double-linked.
- What happens when an invoice has no exact-amount candidate but a foreign-currency transaction with a slightly different amount exists nearby? → Forex candidates (within ±5% amount and ±7 days) are surfaced and the invoice is held `ambiguous` for manual resolution; it is never auto-linked.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST skip any invoice whose `invoice_number` already exists in the invoices table before any matching is attempted.
- **FR-002**: System MUST compute a single invoice's net amount by summing all positive `發票金額` rows minus the absolute value of all negative `發票金額` rows plus any formal `折讓` allowance.
- **FR-003**: System MUST auto-link an invoice to a transaction when exactly one candidate exists within a ±2-day date window with a matching net amount.
- **FR-004**: System MUST classify a linked invoice as `exact` only when the matched transaction is on the same calendar day AND its amount equals the invoice net amount; every other linked match (different day, or different amount such as any forex match) MUST be classified `near`.
- **FR-005**: System MUST NOT create new transactions at any point during the import process.
- **FR-006**: System MUST hold invoices with two or more candidates as `ambiguous` for manual resolution.
- **FR-007**: System MUST count an invoice as `skipped_unmatched` and persist no record only when it has zero exact-amount candidates within ±2 days AND zero forex candidates within ±7 days.
- **FR-008**: When linking an invoice to a transaction, if the transaction has zero existing items, system MUST fill items from the invoice's positive-amount line items only.
- **FR-009**: When linking an invoice to a transaction that already has items, system MUST leave existing items unchanged unless the user explicitly chooses to replace them.
- **FR-010**: System MUST exclude already-linked transactions (those with an existing matched invoice) from the candidate pool.
- **FR-011**: System MUST provide a resolution endpoint that accepts an invoice ID, a chosen transaction ID, and a replace-items flag, and applies the link atomically.
- **FR-012**: System MUST return a post-import summary including counts for: `matched_exact`, `matched_near`, `ambiguous`, `skipped_unmatched`, `skipped_duplicate`, `skipped_voided`, `skipped_zero`, and per-matched-invoice details (seller, confidence, items outcome).
- **FR-013**: When an invoice has zero exact-amount candidates within ±2 days, the system MUST search for forex candidates — unlinked expense transactions whose amount is within ±5% of the net amount and whose date is within ±7 days of the invoice date — and, if any exist, hold the invoice as `ambiguous` for manual resolution. Forex candidates MUST NEVER be auto-linked, regardless of how many exist.

### Key Entities

- **Invoice**: Official government receipt tied to a purchase. Key attributes: invoice number (unique dedup key), seller name, seller tax ID, invoice date, net amount, line items (positive only), match status, confidence level.
- **Candidate Transaction**: An existing unlinked expense transaction proposed for a given invoice. **Exact candidates** match the net amount exactly within ±2 days. **Forex candidates** (used only when no exact candidate exists) match within ±5% of the net amount within ±7 days.
- **Ambiguous Invoice**: An invoice held for manual user resolution — either ≥2 exact candidates, or (when no exact candidate exists) ≥1 forex candidate.
- **Match Confidence**: `exact` (same calendar day AND exact net amount) or `near` (any other linked match, including every forex match).
- **Items Outcome**: Result of items handling for a matched invoice — `filled` (items were empty, filled from invoice), `kept` (items existed, left unchanged), or `replaced` (user explicitly replaced items).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can import a 30-invoice CSV and complete the full reconciliation (including resolving any ambiguous cases) in under 5 minutes on mobile.
- **SC-002**: Re-importing the same CSV file produces zero changes to existing data and completes in under 3 seconds.
- **SC-003**: Zero new transactions are created by the import process under any input — verifiable by transaction count before and after import.
- **SC-004**: The post-import summary accounts for 100% of invoices in the uploaded CSV across all outcome buckets (matched + ambiguous + skipped = total parsed).
- **SC-005**: Ambiguous invoices are presented with enough context (seller, amount, date, candidates) that a user can resolve each one without navigating away from the import screen.

## Assumptions

- The user always has pre-existing manually-entered transactions before running an import; invoice import is an enrichment step, not primary data entry.
- Import frequency is low (monthly or less) — performance optimisation for large CSVs is out of scope.
- The ±2-day window covers date-entry variance for exact-amount domestic matches. Foreign-currency purchases may post several days after the invoice date, so the forex fallback uses a wider ±7-day window; because forex matches are manual-confirm only, the wider window adds candidate options without risking wrong auto-links.
- Discount line items (negative `發票金額` rows) are folded into the net amount calculation and excluded from transaction items — they are not represented as adjustments.
- The user accepts that `near`-confidence matches may occasionally be wrong; the summary makes confidence level visible so the user can manually unlink if needed. An unlink/undo flow is out of scope for this version.
- Formal `折讓` allowance and inline negative rows are treated additively as part of the same allowance total.
- The PWA is the only client for this feature; Discord/Android clients are out of scope.
