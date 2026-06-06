# Feature Specification: Discount-aware net spend for itemized transactions

**Feature Branch**: `025-invoice-discount-net-spend`  
**Created**: 2026-06-06  
**Status**: Draft  
**Input**: User description: "Fix discount-aware spend accounting for filled invoice items so summaries reflect net (paid) amounts, not gross."

## Clarifications

### Session 2026-06-06

- **Discount attribution across categories** → **Proportional** to each item's face value (matches the apportionment the app already uses for net per-item spend). Single-category invoices are unaffected either way.
- **Historical records** → **Correct retroactively** with a one-time backfill, scoped to transactions already filled from discounted invoices. Manually-entered discounted transactions need no backfill — they self-correct the moment summaries start reading the stored net value (see root cause below).
- **Discount visibility** → **Spend-correction only**. Invoice-filled transactions are not given a new editable discount line; correctness comes from the stored net per-item value. The feature-023 matched-card display (`折讓 −X` / `淨額`) remains the visible cue.

### Root cause (two independent issues)

The overcount has two separate causes that happen to compound:

1. **The invoice parser drops the discount line.** When an invoice carries an allowance, its negative line is folded into the invoice's discount total and removed from the item list, so the surviving items sum to **gross**, not net. This only affects items that come from an **invoice fill**.
2. **Summaries ignore the stored net per-item value.** The app already computes and stores each item's net share of the amount actually paid, but the summary aggregation reads only the item's **face** amount. This is independent of invoices — it also overcounts a **manually-entered itemized expense that carries a discount adjustment** (items at full price, paid amount lower).

Because of issue 2, fixing the summary read alone immediately corrects all manual discounted transactions (their net value is already stored). Invoice-filled items additionally need their net value computed on fill (issue 1 left it unset), plus a backfill for already-filled history.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Summaries reflect the net spend already computed (Priority: P1)

A manually-entered itemized expense that carries a discount stores a correct per-item net value, but summaries currently count the full face value and overstate spend. Make every summary that breaks down item-level spend use the stored net value, so these transactions stop overcounting.

**Why this priority**: Foundational and the smallest change — it instantly fixes a whole class of (manual) transactions and is the prerequisite the invoice-fill fix builds on.

**Independent Test**: Record an itemized expense whose paid amount is less than the sum of its items (a discount), open that period's summary, and confirm the items' categories sum to the paid amount and the category totals sum to the grand total.

**Acceptance Scenarios**:

1. **Given** a manually-entered expense with paid amount 450, items A:300 (日用) and B:200 (飲食), and a 50 discount, **When** the period summary is viewed, **Then** 日用 + 飲食 contribute exactly 450 in aggregate (not 500), and the category totals sum to the grand total.
2. **Given** an itemized expense with no discount (items sum to the paid amount), **When** the summary is computed, **Then** category totals are identical to current behaviour.

---

### User Story 2 - Discounted invoices fill net spend (Priority: P2)

When a discounted invoice's items are filled into a transaction (auto-link enrichment or an explicit replace), those items currently have no stored net value and are counted at gross. Compute each item's net value on fill so the summary counts only what was actually paid.

**Why this priority**: This is the originally reported case. It depends on User Story 1 (summaries reading the stored net value); together they deliver the headline fix.

**Independent Test**: Import or manually link a discounted invoice into a transaction that had no items, open the summary, and confirm the filled items' categories sum to the paid amount.

**Acceptance Scenarios**:

1. **Given** an invoice with gross 1000, discount 100, net 900 whose items are A:600 and B:400, filled into a transaction that paid 900, **When** the period summary is viewed, **Then** category A + category B contribute exactly 900 (not 1000).
2. **Given** a non-discounted invoice filled into a transaction, **When** the summary is computed, **Then** totals are unchanged.
3. **Given** a single-item discounted invoice, **When** filled, **Then** that one item's category contribution drops to the net amount.

---

### User Story 3 - Existing discounted invoice records corrected (Priority: P3)

Transactions filled from discounted invoices before this change still count gross in past-period summaries. A one-time backfill corrects them so previously-viewed months reconcile.

**Why this priority**: Cleanup of historical data. Without it only new fills are correct; valuable but lower than stopping the ongoing overcount.

**Independent Test**: Identify a past transaction filled from a discounted invoice that currently overcounts, run the backfill, and confirm that period's category totals now reconcile to the grand total.

**Acceptance Scenarios**:

1. **Given** a historical transaction filled from a discounted invoice that overcounts, **When** the backfill runs, **Then** its category contribution drops to the paid amount.
2. **Given** a historical non-discounted transaction, **When** the backfill runs, **Then** its summary numbers are unchanged.

---

### Edge Cases

- **Single-item discounted invoice/expense**: the whole discount reduces that one item's category.
- **Uneven division**: when the discount cannot be split evenly across items, the rounding remainder is absorbed so the items still sum exactly to the paid amount (no ±1 drift in the period total).
- **Items with no amount / uncategorised remainder**: existing fallback-to-`其他` behaviour still holds, with the net (paid) total respected.
- **Transaction edited after fill**: if the owner later edits the transaction, its summary spend stays reconciled to the amount actually paid, not reverting to gross.
- **Refund transactions**: out of scope — sign handling differs; behaviour unchanged.
- **A transaction filled from more than one invoice** (if it occurs): out of scope; documented as a known limitation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Every summary that aggregates item-level spend (category pie/list and subcategory drilldown) MUST use each item's net value (its share of the amount actually paid), not its face amount.
- **FR-002**: For any period, the sum of per-category totals MUST be less than or equal to the grand total.
- **FR-003**: When an item's net value is derived from a paid amount lower than the items' face total, the difference MUST be distributed across the items **proportionally to each item's face value**, with any rounding remainder absorbed so the items sum exactly to the paid amount.
- **FR-004**: When invoice items are filled into a transaction that had no items (auto-link enrichment) or replace its items (explicit replace), the filled items MUST carry a net value reflecting the transaction's actual paid amount.
- **FR-005**: Transactions and invoices that carry **no** discount MUST produce summary numbers identical to today (zero regression).
- **FR-006**: Transactions already filled from discounted invoices before this change MUST be corrected by a one-time backfill so past-period summaries reconcile. Manually-entered discounted transactions require no backfill (they are corrected by FR-001 alone).
- **FR-007**: Invoice-filled transactions MUST NOT be given a new editable discount line; the correction comes from the stored net value only. (The feature-023 matched-card display remains the visible cue.)
- **FR-008**: After the owner edits such a transaction, its summary spend MUST remain reconciled to the amount actually paid (it must not revert to gross).
- **FR-009**: The rounding error introduced by splitting a discount across items MUST be at most 1 currency unit per transaction.

### Key Entities *(include if feature involves data)*

- **Invoice**: gross amount, discount/allowance, net amount, line items, and provenance linking it to the transaction it filled.
- **Transaction**: the recorded spend whose amount equals what was actually paid (net of any discount).
- **Transaction Item**: a line of the transaction with a face amount, a category tag, a provenance marker indicating whether it came from an invoice, and a stored net value (its share of the paid amount) used by summaries.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every discounted transaction (manual or invoice-filled), the items' total contribution to category summaries equals the transaction's paid amount — overcount is 0.
- **SC-002**: Across any period, the sum of category totals is ≤ the grand total (today it can exceed it).
- **SC-003**: For all non-discounted transactions, summary numbers are unchanged versus current behaviour — 0 regressions.
- **SC-004**: After the backfill, every previously-affected past period reconciles: the category total sum equals the grand total within rounding.
- **SC-005**: Per-transaction discount-split rounding error is ≤ 1 currency unit.

## Assumptions

- "Paid (net) amount" is the transaction's recorded amount; a matched transaction already reflects the amount actually charged after the discount.
- The app already computes and stores a per-item net value for itemized transactions at creation/edit time; manually-entered discounted transactions therefore already hold the correct net value and only need summaries to read it.
- Invoice-filled items currently lack a stored net value because the fill path never computed one and the parser had dropped the discount line.
- Proportional attribution matches the app's existing net-spend apportionment, so manual and invoice paths stay consistent.
- The feature-023 matched-card display reconciliation stays as-is; this feature concerns stored data and summary aggregation correctness, not that display.
- Data volumes are personal-scale (hundreds of transactions/month), so a one-time backfill is operationally cheap.
- Scope is limited to expense transactions; refunds and transactions filled from multiple invoices are out of scope.
