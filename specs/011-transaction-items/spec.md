# Feature Specification: Transaction Items Table

**Feature Branch**: `011-transaction-items`
**Created**: 2026-05-16
**Status**: Draft

## Clarifications

### Session 2026-05-16

- Q: When item amounts exceed the transaction total, is it a hard reject (nothing written to DB) or a soft warn? → A: Hard reject at parse time — show error, write nothing to DB.
- Q: When invoice item count differs from transaction items, are originals preserved or replaced? → A: Replace entirely — invoice data is authoritative.
- Q: For a single-item transaction with a null item amount, does aggregation show the amount under its category or under 其他? → A: Under its category — a single null-amount item inherits the full transaction total for aggregation.
- Q: When invoice import replaces existing transaction items (count mismatch), should the user see a warning? → A: Yes — show a warning listing the items being discarded before the replacement is written.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Single-Category Expense Entry (Priority: P1)

A user records a straightforward expense via Discord. They type their entry as they do today. The system stores it as a transaction (payment envelope) with one attached item that automatically inherits the full amount and the category tag. The summary command reflects the category correctly, same as before.

**Why this priority**: Covers the dominant use case (~90% of entries). Must be non-regressive — existing /expense, /fee, /refund flows continue to work without behaviour change visible to the user.

**Independent Test**: Enter `/expense 120 食:午餐 便當` — verify one transaction row and one item row appear in storage. Verify `/summary month` shows 食 category includes NT$120. Verify the confirmation message in Discord is unchanged.

**Acceptance Scenarios**:

1. **Given** a user submits `/expense 120 食:午餐 便當`, **When** the system processes it, **Then** a transaction is created with amount 120 and a linked item with name "便當", amount 120, and tag "食:午餐"
2. **Given** a user submits `/fee 30 行:手續費`, **When** the system processes it, **Then** a transaction is created with amount 30 and a linked item with the fee description, amount 30, and tag "行:手續費"
3. **Given** a user submits `/refund 50 食:午餐`, **When** the system processes it, **Then** a refund transaction is created with a linked item carrying the category tag
4. **Given** an expense is recorded, **When** `/summary month` is called, **Then** the amount appears under the correct category, identical to pre-feature behaviour

---

### User Story 2 — Multi-Item Expense with Known Split (Priority: P1)

A user buys multiple things in one trip and knows the individual prices. They enter each item with its amount and category. The system stores all items linked to one transaction. The summary command breaks the spend across the correct categories, not lumped into 其他.

**Why this priority**: Core value proposition of this feature — unlocks per-category accuracy for mixed purchases.

**Independent Test**: Enter a single convenience store transaction of NT$180 with two items: 食:早餐 NT$60, 醫:藥 NT$120. Verify `/summary month` shows 食 +60 and 醫 +120. Verify the transaction total is 180, not 360.

**Acceptance Scenarios**:

1. **Given** a user enters a NT$180 transaction with items [{早餐, 60, 食:早餐}, {感冒藥, 120, 醫:藥}], **When** stored, **Then** items.amounts sum to transaction.amount (180) and each item carries its own category tag
2. **Given** the above transaction exists, **When** `/summary month` runs, **Then** 食 includes NT$60 and 醫 includes NT$120 — no double-counting of the NT$180 total
3. **Given** a multi-item transaction exists, **When** `/amend amount:200` targets it, **Then** the system warns that item amounts no longer sum to the new total rather than silently accepting

---

### User Story 3 — Multi-Item Expense with Unknown Split (Priority: P2)

A user records a mixed purchase but does not know the exact per-item breakdown at entry time. They list item names and categories without amounts. The transaction total is stored correctly. Item amounts are left empty for later reconciliation (e.g. after an invoice arrives). The summary shows the transaction under 其他 until item amounts are filled in.

**Why this priority**: Supports the "capture now, reconcile later" workflow. Correct summary is deferred — acceptable trade-off.

**Independent Test**: Enter a NT$237 transaction at 全家 with two items: 零食 (no amount, 食:零食) and 日用品 (no amount, 住:日用品). Verify the transaction is stored with amount 237. Verify items exist with no amounts. Verify `/summary month` counts 237 under 其他 (not 食 or 住). After manually setting item amounts to 150 and 87, verify summary shifts to the correct categories.

**Acceptance Scenarios**:

1. **Given** a user enters items without amounts, **When** stored, **Then** item amount fields are null/empty and no validation error is raised
2. **Given** items have no amounts, **When** `/summary month` runs, **Then** the transaction total is counted under 其他
3. **Given** item amounts are later filled in (summing to the transaction total), **When** `/summary month` runs, **Then** amounts appear under the correct per-item categories

---

### User Story 4 — Invoice Import Populates Item Amounts (Priority: P2)

When an invoice is imported and matched to a transaction, the invoice's line-item detail (name, unit price, amount) populates the corresponding transaction items. If transaction items already have names from the original entry, amounts are filled in. The summary can then reflect per-category spend for that transaction.

**Why this priority**: Closes the "capture now, reconcile later" loop started in US3.

**Independent Test**: Import an invoice for a matched transaction that had items with no amounts. After import, verify each item has an amount drawn from the invoice line items. Verify `/summary month` now shows those amounts under the correct categories.

**Acceptance Scenarios**:

1. **Given** a matched transaction has items without amounts, **When** an invoice is imported and matched, **Then** invoice line-item amounts are written to the corresponding transaction items
2. **Given** invoice line items don't map cleanly to existing items (different count or names), **When** imported, **Then** the system shows a warning listing the existing items that will be discarded, then replaces them entirely with invoice line items — invoice data is treated as authoritative
3. **Given** transaction items already have amounts, **When** a matching invoice is imported, **Then** existing amounts are not overwritten

---

### User Story 5 — /amend Propagates Amount to Single-Item Transactions (Priority: P1)

A user corrects a typo in a transaction amount via `/amend`. If the transaction has exactly one item and that item's amount matched the old transaction total, the item amount is updated automatically. The correction is fully consistent with no manual follow-up needed.

**Why this priority**: Keeps the most common amend case (single-item typo fix) zero-friction. Without this, every amend would leave orphaned item data.

**Independent Test**: Record a single-item expense of NT$100. Use `/amend amount:110` to correct it. Verify both transaction.amount and item.amount are 110.

**Acceptance Scenarios**:

1. **Given** a transaction has one item whose amount equals the transaction total, **When** `/amend` sets a new amount, **Then** both transaction.amount and item.amount are updated to the new value
2. **Given** a transaction has multiple items with explicit amounts, **When** `/amend` sets a new total, **Then** the system warns the user that item amounts no longer sum correctly — item amounts are not auto-adjusted
3. **Given** a transaction has items with no amounts, **When** `/amend` sets a new total, **Then** transaction.amount is updated silently (no items to cascade to)

---

### Edge Cases

- What if a user enters zero items? Transaction is stored with no linked items — summary falls to 其他.
- What if item amounts sum to more than the transaction total? System rejects the entry at parse time with a clear error message — nothing is written to the database.
- What if item amounts sum to less than the transaction total (partial split)? Accepted — the remainder is unallocated and counted under 其他 in summary.
- What if an invoice has a different item count than the transaction's items? The system shows a warning listing the items being discarded, then replaces existing transaction items entirely with invoice line items — invoice data is authoritative for what was purchased.
- What if a transaction is deleted? All linked items are deleted via cascade.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each transaction MUST have zero or more linked items stored independently of the transaction record
- **FR-002**: Each item MUST have a name and MAY have an amount; amount is optional at entry time
- **FR-003**: Each item MUST carry its own category tags (zero or more), independent of the transaction's tags
- **FR-004**: Transaction tags MUST contain only transaction-level context (store name, payment context) — category tags MUST NOT be stored on the transaction itself
- **FR-005**: When a transaction has exactly one item and no explicit item amount, the item amount MUST be treated as equal to the transaction total for summary purposes — the full transaction amount appears under the item's category tag (not under 其他)
- **FR-006**: When item amounts are present and sum to less than the transaction total, the unallocated remainder MUST be counted under 其他 in summary
- **FR-007**: When item amounts are present and their sum exceeds the transaction total, the system MUST reject the entry at parse time with an error message before any database write is attempted
- **FR-008**: The spending summary MUST aggregate spend by category from item-level tags, not transaction-level tags
- **FR-009**: Transactions without any categorised items MUST appear under 其他 in summary
- **FR-010**: /amend MUST cascade an amount change to a single-item transaction's item amount when the item previously matched the transaction total
- **FR-011**: /amend MUST warn the user when a multi-item transaction's items would become inconsistent after an amount change
- **FR-012**: Invoice import MUST populate item amounts on matched transactions that have items without amounts
- **FR-013**: Deleting a transaction MUST delete all its linked items
- **FR-014**: The existing /expense, /fee, and /refund entry flows MUST continue to work without visible behaviour change for single-category entries
- **FR-015**: When invoice import replaces existing transaction items due to a count mismatch, the system MUST display a warning that lists the item names being discarded before writing the replacement items

### Key Entities

- **Transaction**: Payment envelope — total amount, payment method, date, store/context tags, transaction type. No category tags. Has zero or more items.
- **Transaction Item**: One line item within a transaction — name, optional amount, zero or more category tags (category:subcategory format), sort order. Belongs to exactly one transaction.
- **Summary Category**: Derived view — aggregates item amounts by the first category tag on each item across a time period. Exception: a transaction with exactly one item and no explicit item amount is aggregated using the full transaction total under that item's category tag. Items with no amounts in multi-item transactions, or items with no category tags, contribute their share to 其他.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A mixed-category purchase is correctly split across categories in `/summary` with zero manual post-processing, provided item amounts are known at entry time
- **SC-002**: All existing single-category expense entries continue to appear correctly in `/summary` with no regression in category totals
- **SC-003**: An invoice import for a matched transaction fills in all item amounts in a single operation, requiring no further manual edits
- **SC-004**: `/amend` on a single-item transaction requires exactly one command — no follow-up edit to fix item amount consistency
- **SC-005**: A transaction recorded without item amounts appears under 其他 in summary until amounts are provided — never silently miscategorised

## Assumptions

- Existing test data in the database will be dropped before this feature is deployed — no backward data migration is required
- The Discord bot is the sole entry point for new transactions; no other write path exists that bypasses item creation
- Item-level editing (add/remove items, change item name or category after creation) is out of scope for this feature — a follow-on /edit command will address that
- Item-level invoice reconciliation (matching individual invoice lines to individual transaction items) is out of scope — invoice matching remains at the transaction level for now
- A transaction may have items with a mix of known and unknown amounts (partial split) — this is a valid state
- The legacy migration (010-migrate-legacy) will be updated separately to write into the new items table once this feature is shipped
