# Feature Specification: Invoice Reconciliation Enhancements

**Feature Branch**: `023-invoice-reconcile-enhancements`
**Created**: 2026-06-05
**Status**: Draft
**Input**: Deferred enhancements from feature 022 (Invoice Import v2), documented in `specs/022-invoice-import-v2/manual-link-plan.md` → "Deferred enhancements".

## User Scenarios & Testing *(mandatory)*

This feature continues the enrichment-only invoice reconciliation work: importing
government e-invoices and linking them to existing expense transactions. It never
creates or deletes a transaction. Three independent improvements, each delivering
value on its own.

### User Story 1 - Keep the linked-invoice list a manageable review queue (Priority: P1)

After importing invoices over time, the list of already-linked invoices on the Import
screen accumulates every invoice ever matched. The user opens the screen to *review*
recent auto-matches (and undo any wrong ones), but the list grows without bound and
becomes slow and noisy. The user wants to mark a reviewed match as acknowledged so it
drops off the list, individually or all at once, leaving only matches they haven't yet
checked. Invoices still awaiting manual resolution are never dismissed this way — they
remain until the user links them.

**Why this priority**: This is the most pressing issue — the linked list degrades with
every import and is already the slowest part of opening the screen. It blocks the screen
from being a useful ongoing review tool.

**Independent Test**: With several linked invoices present, mark some as read and confirm
they leave the list and do not return on re-entry; mark all as read and confirm the list
is empty; confirm invoices awaiting manual resolution are unaffected. Deliverable on its
own without US2/US3.

**Acceptance Scenarios**:

1. **Given** several linked invoices in the review list, **When** the user marks one as
   read, **Then** it disappears from the list and does not reappear when the screen is
   reopened.
2. **Given** several linked invoices, **When** the user chooses "mark all as read",
   **Then** the list becomes empty and stays empty on re-entry.
3. **Given** invoices awaiting manual resolution, **When** the user marks linked invoices
   as read, **Then** the awaiting-resolution list is unchanged (those are never
   auto-dismissed).
4. **Given** a large history of matched invoices, **When** the user opens the Import
   screen, **Then** only unacknowledged matches load and the screen opens without
   noticeable delay.

---

### User Story 2 - Auto-match discounted purchases (Priority: P2)

A common case is an expense paid below the invoice's face value because of an
at-the-register discount that isn't itemised on the invoice (e.g. a NT$5 reusable-cup
discount: invoice shows NT$40, the user paid and recorded NT$35 with the discount noted).
Today such an expense is never auto-linked, because matching only compares the invoice
amount to the amount paid. The user wants a properly-recorded discounted expense to
auto-link to its full-price invoice, with no manual step.

**Why this priority**: Reduces manual reconciliation for an everyday case, but only
benefits expenses recorded *with* their discount going forward — it does not repair
already-recorded flat-amount expenses (those still use manual link), so its reach is
narrower than US1.

**Independent Test**: Record an expense with a discount such that paid + discount equals
an invoice's amount; import that invoice and confirm it auto-links. Confirm an expense
with no discount, and one whose pre-discount total still doesn't match, are unaffected.

**Acceptance Scenarios**:

1. **Given** an expense recorded as paid NT$35 with a NT$5 discount, **When** an invoice
   for NT$40 on the same day is imported, **Then** the invoice auto-links to that expense.
2. **Given** an expense with no discount recorded, **When** invoices are imported, **Then**
   matching behaves exactly as before (no change).
3. **Given** an expense whose pre-discount total still differs from every invoice, **When**
   invoices are imported, **Then** it is not auto-linked (falls through to the existing
   manual/ambiguous paths).

---

### User Story 3 - Replace a placeholder item when manually linking (Priority: P3)

Legacy-imported transactions often carry a generic placeholder line item (e.g. "早餐"
categorised as 食:早餐). When the user manually links an invoice that has the real product
line, they want to *replace* that placeholder with the invoice's item name rather than
add a second item alongside it. The replacement must target the specific placeholder the
user chooses and must not pull in unrelated invoice lines (e.g. a separately pre-paid item
on a multi-line invoice).

**Why this priority**: A convenience for cleaning up legacy item names during manual
linking. There is already a workaround (link with no items, rename in the edit screen), so
it's the lowest priority of the three.

**Independent Test**: Manually link an invoice to a transaction that has a placeholder
item; choose to replace that placeholder with one invoice line; confirm the placeholder is
replaced (not duplicated) and other invoice lines are not added.

**Acceptance Scenarios**:

1. **Given** a transaction with a placeholder item, **When** the user manually links an
   invoice and chooses to replace that placeholder with one invoice line, **Then** the
   transaction ends with the invoice line in place of the placeholder (no duplicate).
2. **Given** a multi-line invoice, **When** the user replaces a placeholder with one line,
   **Then** only that line is applied — the other lines are not added.
3. **Given** the user does not choose replace, **When** they manually link, **Then**
   behaviour is unchanged (append-only, as today).

### Edge Cases

- Marking an invoice as read, then later un-linking and re-matching it: the new match is
  treated as a fresh, unacknowledged match and reappears in the review list.
- A discounted expense that matches more than one invoice once its pre-discount total is
  considered → must remain ambiguous (never silently auto-link to one).
- Discount-aware matching must not widen matches for transactions that record fees or
  refunds rather than discounts (only discounts raise the comparison amount).
- Replacing a placeholder whose amount differs from the invoice line → the transaction's
  paid amount is unchanged; the item breakdown is reconciled as it is for any item edit.
- "Mark all as read" with zero unacknowledged matches is a no-op.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The linked-invoice review list MUST show only matches the user has not yet
  acknowledged (marked as read).
- **FR-002**: Users MUST be able to mark an individual linked invoice as read, removing it
  from the review list.
- **FR-003**: Users MUST be able to mark all currently-listed linked invoices as read in
  one action.
- **FR-004**: A read/acknowledged state MUST persist across sessions and screen re-entry.
- **FR-005**: Invoices awaiting manual resolution MUST NOT be dismissible by the
  mark-as-read actions; they persist until linked.
- **FR-006**: Opening the Import screen MUST remain responsive regardless of how many
  invoices have been matched historically (the review list is bounded to unacknowledged
  matches).
- **FR-007**: Auto-matching MUST consider, in addition to the amount paid, the expense's
  pre-discount total (amount paid plus its recorded discount) when comparing to an invoice
  amount.
- **FR-008**: Discount-aware matching MUST NOT change the result for transactions that have
  no recorded discount.
- **FR-009**: When exactly one expense matches an invoice by pre-discount total (and none
  by paid amount), the system MUST auto-link it; if more than one matches, it MUST remain
  ambiguous (never silently pick one).
- **FR-010**: During manual link, users MUST be able to replace a chosen existing item with
  a selected invoice line, as an alternative to appending.
- **FR-011**: A replace action MUST apply only the user-selected invoice line(s) and MUST
  NOT add other lines from the same invoice.
- **FR-012**: All actions in this feature MUST remain enrichment-only — no action creates
  or deletes a transaction (carried from feature 022, SC-003).

### Key Entities *(include if feature involves data)*

- **Invoice**: a parsed government e-invoice. Gains an acknowledgement (read) state used to
  filter the linked-invoice review list. Existing match state (matched / ambiguous) is
  unchanged.
- **Expense transaction**: an existing recorded expense. Has an amount paid and may have
  recorded adjustments (including discounts) and line items.
- **Discount adjustment**: a recorded reduction on a transaction; its value raises the
  amount used for discount-aware matching.
- **Transaction line item**: a named/priced line on a transaction; may be a legacy
  placeholder the user wants to replace with an invoice line. Items created by linking an
  invoice are already distinguishable from user-entered ones.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After marking matches as read, the linked-invoice review list contains only
  unacknowledged matches; a fully-reviewed list is empty and stays empty on re-entry.
- **SC-002**: Opening the Import screen completes in under 1 second regardless of total
  historical matched-invoice count (e.g. with 1,000+ matched invoices on record).
- **SC-003**: No import, mark-as-read, manual link, or item replace ever changes the total
  number of transactions (enrichment-only invariant holds).
- **SC-004**: A discounted expense recorded with its discount auto-links to its full-price
  invoice in the same import that previously left it unmatched — with zero manual steps.
- **SC-005**: When manually linking, a user can replace a placeholder item with an invoice
  line so the transaction ends with exactly one item for that line (no duplicate) and no
  unrelated invoice lines added.

## Assumptions

- Builds directly on feature 022 (Invoice Import v2): enrichment-only, the matched /
  ambiguous / skipped-unmatched model, the manual-link flow, and item provenance already
  exist and are reused.
- "Discount" for US2 means a recorded discount-type adjustment only. Fees and refunds are
  out of scope for raising the match amount (they have different, messier semantics).
- US2 only helps expenses recorded *with* their discount going forward; legacy flat-amount
  expenses are not repaired by it and continue to rely on manual link.
- For US3, replacing a placeholder item adopts the invoice line's name and amount while
  preserving the existing item's category tags (so the user keeps categorisation while
  gaining the real product name). [To confirm in /speckit-clarify if undesired.]
- Acknowledgement (read) state is per-invoice and one-way; there is no "mark as unread"
  in this feature (a re-match after un-link naturally produces a fresh, unread match).
- The matched/linked review list and the awaiting-resolution list both reflect the full
  cumulative backlog across imports (as today), now filtered by read state for the former.
