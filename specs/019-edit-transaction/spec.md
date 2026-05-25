# Feature Specification: Edit Transaction

**Feature Branch**: `019-edit-transaction`
**Created**: 2026-05-25
**Status**: Draft
**Input**: User description: "Add a transaction edit flow to the PWA. Currently there is no way to edit a submitted transaction from the PWA — users can only view history. This feature adds the ability to open any existing expense transaction from the history list, edit its fields (amount, payment method, category, tags, note, items, adjustments), and save the changes. The edit form should reuse the existing EntryScreen components. Backend needs a PUT /pwa/transactions/:id endpoint that updates the transaction header, replaces items, and replaces adjustments (then recomputes effective_amount). Fee and refund transactions are out of scope for editing — only expense type."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Correct a Mistake on a Recently Submitted Expense (Priority: P1)

A user submits an expense and immediately notices they entered the wrong amount or misspelled an item name. They tap the transaction in the history list, the edit form opens pre-filled with all current values, they fix the mistake, and tap Save.

**Why this priority**: The most common edit scenario and the minimum viable form of the feature — any single field correction delivers immediate value.

**Independent Test**: Submit a transaction, open it via history, change the amount, save. Verify the transaction record reflects the new amount and all other fields are unchanged.

**Acceptance Scenarios**:

1. **Given** an expense transaction exists in history, **When** the user taps it and selects Edit, **Then** an edit form opens with all current field values pre-filled (amount, payment method, category, free tags, note, items, adjustments).
2. **Given** the edit form is open, **When** the user changes the amount and saves, **Then** the transaction's amount is updated, `effective_amount` on items is recomputed, and the history list reflects the new value.
3. **Given** the edit form is open, **When** the user taps Save without changing anything, **Then** the transaction is saved unchanged — no data is lost or reset.
4. **Given** a fee or refund transaction appears in history, **When** the user views it, **Then** no Edit button is shown — only expense transactions are editable.

---

### User Story 2 - Update Items and Adjustments on an Existing Transaction (Priority: P2)

A user recorded a transaction with items but realised they missed one item or entered an adjustment incorrectly. They open the edit form, add the missing item or correct the adjustment, and save. Items and adjustments are fully replaced on save.

**Why this priority**: Completes the edit surface for structured data; depends on P1 (edit form) being built.

**Independent Test**: Open an existing transaction with 1 item and 1 adjustment. Add a second item, change the adjustment amount. Save. Verify the stored items and adjustments reflect the changes and `effective_amount` is recomputed.

**Acceptance Scenarios**:

1. **Given** the edit form is open with existing items, **When** the user adds a new item row and saves, **Then** the new item is stored alongside the existing items.
2. **Given** the edit form is open with an existing adjustment, **When** the user deletes it and saves, **Then** no adjustments remain on the transaction and `effective_amount` is recomputed against the items and paid total.
3. **Given** the edit form is open, **When** the user changes an item's amount and saves, **Then** `effective_amount` is recomputed proportionally across all items based on the new paid total.

---

### Edge Cases

- Transaction with no items: edit form shows no item rows; user can add items during edit.
- Transaction with no adjustments: adjustments section is collapsed/empty; user can add adjustments during edit.
- Saving with empty items list: allowed — transaction header is updated, items table for this transaction is cleared.
- Concurrent edit (two devices): last save wins; no optimistic locking in scope for v1.
- Non-expense transaction (fee/refund) accessed via direct URL: edit form is not shown; user sees a read-only view or an informational message.
- `transaction_at` (the original timestamp): preserved on edit — users do not change when the transaction occurred, only its content.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The history list MUST display an Edit entry point (button or tap target) on each expense-type transaction row. Fee and refund rows MUST NOT have an edit entry point.
- **FR-002**: Tapping the edit entry point MUST open an edit form pre-filled with all current transaction values: amount, payment method, category tag, free tags, note, all item rows (name, amount, tag, note), and all adjustment rows (kind, amount, note).
- **FR-003**: The edit form MUST allow the user to modify any combination of: amount, payment method, category, free tags, transaction note, items (add/remove/edit), and adjustments (add/remove/edit).
- **FR-004**: `transaction_at` (the original timestamp of the transaction) MUST be preserved on save — the edit flow does not expose a date/time picker.
- **FR-005**: On save, the backend MUST atomically update the transaction header, replace all items for that transaction, replace all adjustments, and recompute `effective_amount` on all items.
- **FR-006**: The same client-side reconciliation warning shown on entry (orange ⚠ when item sum minus adjustments ≠ entered amount) MUST appear in the edit form under the same conditions.
- **FR-007**: After a successful save, the user is returned to the history list and the updated transaction is reflected immediately.
- **FR-008**: If the save fails (network error, server error), the edit form remains open with the user's unsaved changes intact and a clear error message is shown.
- **FR-009**: The edit form MUST honour the item note field introduced in feature 018 — existing item notes are pre-filled and editable.

### Key Entities

- **Transaction (expense)**: The record being edited. Header fields (amount, payment_method, tags, note) are updated in place. `transaction_at` and `id` are immutable.
- **Transaction items**: Fully replaced on save — old items deleted, new set inserted. `effective_amount` recomputed after replacement.
- **Transaction adjustments**: Fully replaced on save — old adjustments deleted, new set inserted. Triggers `effective_amount` recomputation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can open, edit, and save an expense transaction in under 60 seconds for a typical correction (single field change).
- **SC-002**: All fields present at entry time (amount, payment method, category, tags, note, items, adjustments) are pre-filled correctly in the edit form — 0 fields lost or blank on open.
- **SC-003**: After saving an edit, `effective_amount` on all items reflects the updated paid total — 0 stale values remain.
- **SC-004**: Fee and refund transactions have no edit entry point exposed — 0 non-expense transactions are editable via this flow.
- **SC-005**: A save failure leaves the transaction data unchanged in the database — 0 partial writes on error.

## Assumptions

- Only the authenticated user's own transactions appear in history — no multi-user or permission concerns.
- `transaction_at` is immutable via this edit flow; a separate "reback-date" feature is out of scope.
- The edit form is a full-screen modal or separate screen, not an inline edit — consistent with the entry form UX pattern.
- Fee and refund transactions require a different edit model (parent linkage, sign semantics) and are explicitly out of scope.
- Deleting a transaction is out of scope for this feature — edit only.
- Feature 018 (item note) is a soft dependency: if 018 ships first, the edit form must carry item notes. If 019 ships before 018, item notes are simply absent from the edit form until 018 is added.
