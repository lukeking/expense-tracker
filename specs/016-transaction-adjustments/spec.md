# Feature Specification: Transaction Adjustments + Legacy Data Cleanup

**Feature Branch**: `016-transaction-adjustments`
**Created**: 2026-05-24
**Status**: Draft
**Input**: User description: "Add a transaction_adjustments table (kind: fee | refund | discount) to record order-level monetary modifiers that today are faked as separate transaction rows or missing entirely. Also add transaction_items.effective_amount (proportional distribution of paid_total across items) so summary analytics reflect actually-paid amounts, not MSRP. Scope includes: (1) schema; (2) bulk data cleanup of all anomalies surfaced by the 015 audit script; (3) rewrite the summary RPC to aggregate on effective_amount; (4) PWA entry/edit flow updates to support recording adjustments; (5) patch the audit script with a rewritten FR-010 and two new invariants."

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Record a transaction with an order-level adjustment (Priority: P1)

The user places an order and receives a platform point-credit discount or pays a service fee alongside the item purchases. Today there is no clean place to record either of these — discounts go unrecorded or are faked as refund transactions, fees are stored as separate transaction rows linked by a `parent_transaction_id`. After this feature, the user enters the adjustment (kind, amount, optional note) on the same transaction form, and the system stores it correctly and distributes the economic effect proportionally across the items.

**Why this priority**: Without this, the core problem (analytics lie) persists for all future transactions. This is the forward-looking fix; the legacy cleanup (P2) is the backward-looking fix.

**Independent Test**: Create a new transaction with two items ($300, $200) and a $50 point-credit discount. Verify the summary drill-in shows a $250 total, the larger item carries the proportional discount, and the transaction record's paid total ($250) matches the sum of item effective amounts.

**Acceptance Scenarios**:

1. **Given** a new transaction is being created, **When** the user adds a "discount" adjustment of NT$50 with note "LINE點折抵", **Then** the adjustment is saved and associated with the transaction, and each item's `effective_amount` is recalculated proportionally.
2. **Given** a transaction exists with a $50 discount and items of $300 and $200, **When** the user views the category summary, **Then** the category totals reflect $250 (not $500), with $150 attributed to item 1's category and $100 to item 2's category (proportional).
3. **Given** a transaction has adjustments, **When** the user opens it in the edit view, **Then** the existing adjustments are displayed and can be modified or deleted, with `effective_amount` recomputed on save.
4. **Given** a single-item transaction with a $30 fee added, **When** saved, **Then** that item's `effective_amount` = `item.amount + fee.amount` (fee increases the economic burden attributed to the item).

---

### User Story 2 — Legacy data cleanup: truthful analytics on existing records (Priority: P2)

The 015 audit script found 15,157 transactions where a `major:sub` category tag is sitting on `transactions.tags` instead of `transaction_items.tags` — a violation of the tag namespace rule. As a result, category drill-in totals for legacy-migrated data are wrong (items have no category, so they don't aggregate into any category bucket). After this feature, all legacy records are corrected: category tags live on items, items that were missing get backfilled, and the summary accurately reflects historical spend.

**Why this priority**: The category summary feature is the primary analytics interface. With 15,157 miscategorised transactions, virtually all historical data is invisible in the category view.

**Independent Test**: Run the 015 audit script before and after the migration; verify `category_tag_on_transaction` drops from 15,157 to 0.

**Acceptance Scenarios**:

1. **Given** 15,157 transactions carry `major:sub` tags on `transactions.tags`, **When** the migration runs, **Then** all such tags are moved to the corresponding `transaction_items.tags`, and `transactions.tags` retains only non-`:` context tags.
2. **Given** 6 transactions have no items at all, **When** the migration runs, **Then** each receives one default item mirroring the transaction's amount and note, and the category tag is moved to that item.
3. **Given** 6 standalone fee/refund transactions exist with `parent_transaction_id`, **When** the migration runs, **Then** each is converted to a row in `transaction_adjustments` linked to the parent transaction, and the original fee/refund transaction row is deleted.
4. **Given** 24 `transaction_items` carry tags referencing category names that don't exist in the `categories` table, **When** the migration runs, **Then** the 015 audit script reports `orphan_category_tag_on_item = 0`.
5. **Given** 2 transactions where `SUM(items.amount) ≠ transaction.amount`, **When** the migration fixes the discrepant items, **Then** the 015 audit script reports `items_sum_mismatch = 0`.

---

### User Story 3 — Audit script reflects the new data model (Priority: P3)

The 015 audit script has invariants written against the old shape (`SUM(items.amount)` compared to `transaction.amount`, no awareness of adjustments). After this feature, the audit script is updated so it checks the correct invariant (`SUM(items.effective_amount)` = `transaction.amount` when adjustments are present), adds a new invariant that catches adjustment-sum mismatches, and adds a heuristic pattern check to detect any pre-016 fake-refund-as-discount rows that the migration might have missed.

**Why this priority**: Without patching the audit script, the 015-era invariant FR-010 will start false-firing on any transaction with a legitimate discount (because `SUM(items.amount)` > `transaction.amount` is now valid and expected). This blocks future audit runs.

**Independent Test**: After migration, run the audit script and verify: the rewritten FR-010 reports 0 violations; the new invariant reports 0 violations; no heuristic pattern check rows are found.

**Acceptance Scenarios**:

1. **Given** a transaction with adjustments where the invariant `SUM(items.effective_amount) = transaction.amount` holds, **When** the audit script runs, **Then** it reports 0 violations for the rewritten FR-010.
2. **Given** a transaction is manually corrupted so `SUM(items.effective_amount) ≠ transaction.amount`, **When** the audit script runs, **Then** the new invariant flags it.
3. **Given** a transaction matches the heuristic for a pre-016 fake-refund-as-discount (refund amount is 5/10/15/20% of parent, or round NT$, within ~5 minutes of parent), **When** the audit script runs, **Then** the heuristic pattern check surfaces it in the report.

---

### Edge Cases

- What happens when a transaction has one item with `amount = NULL`? The `NULL` item is skipped during `effective_amount` distribution; its `effective_amount` remains `NULL`.
- What happens when rounding leaves a 1-unit remainder in proportional distribution? The remainder is added to the item with the largest `amount` (ties: last by `sort_order`), so `SUM(effective_amount)` always equals the paid total exactly.
- What happens when all items on a transaction have `amount = NULL`? No `effective_amount` distribution is possible; the audit new-invariant check skips the transaction (documented assumption).
- What happens when an adjustment is added to a transaction that already has `effective_amount` values? The values are recomputed from scratch on every save — no incremental patching.
- What happens to the 6 orphan fee/refund rows that have no parent transaction at all? They cannot be automatically converted; they are surfaced in the migration output for manual review and left untouched until resolved.
- How are stacked adjustments (multiple fee/discount/refund on one transaction) displayed? In insertion order.
- What happens when an invoice-fill import creates items that conflict with manually entered items? The existing ambiguous-match flow is used unchanged.

---

## Requirements *(mandatory)*

### Functional Requirements

**Schema**

- **FR-001**: The system MUST have a `transaction_adjustments` table with at minimum: `id`, `transaction_id` (FK to `transactions`), `kind` (`fee` | `refund` | `discount`), `amount` (integer, always stored as a positive number), `note`, `source`, `created_at`, `updated_at`.
- **FR-002**: The `transaction_items` table MUST have an `effective_amount` integer column.
- **FR-003**: On every write that creates or modifies a transaction's items or adjustments, the system MUST recompute `effective_amount` for all items on that transaction. Recomputation is app-side (no database triggers or generated columns).
- **FR-004**: The `effective_amount` distribution rule is: distribute `paid_total` (= `transaction.amount`) proportionally by item `amount` ratio; floor each share; assign the rounding remainder to the item with the largest `amount` (ties: last by `sort_order`). Items with `amount = NULL` are skipped and their `effective_amount` is left `NULL`.
- **FR-005**: The sign of an adjustment's economic effect is determined solely by its `kind`: `fee` increases the total (items bear more), `refund` and `discount` decrease the total (items bear less). The `amount` column itself is always positive.

**Summary RPC**

- **FR-006**: The summary RPC MUST aggregate category totals using `SUM(transaction_items.effective_amount)` rather than `SUM(transaction_items.amount)` so that discounts and fees are reflected in per-category spend figures.

**PWA Entry & Edit**

- **FR-007**: The transaction entry form MUST allow the user to add one or more adjustments (kind, amount, optional note) before saving a transaction.
- **FR-008**: The transaction edit form MUST display existing adjustments and allow the user to add, modify, or delete them, with `effective_amount` recomputed on save.

**Legacy Data Migration**

- **FR-009**: A one-time migration MUST move `major:sub` formatted tags from `transactions.tags` to the corresponding `transaction_items.tags`. After migration, `transactions.tags` MUST NOT contain any tag that includes a `:` character (for migrated rows).
- **FR-010**: A one-time migration MUST backfill a default `transaction_items` row for each of the 6 `transactions_without_items` rows, using the transaction's `amount` and `note`, before the category-tag migration runs.
- **FR-011**: A one-time migration MUST convert the 6 standalone fee/refund transaction rows (those with a `parent_transaction_id`) to `transaction_adjustments` rows on the parent transaction, and delete the original fee/refund transaction rows.
- **FR-012**: The migration MUST surface the 6 orphan fee/refund rows (no parent at all) in its output and leave them untouched for manual review; it MUST NOT auto-delete or auto-convert them.
- **FR-013**: The 24 `orphan_category_tag_on_item` rows MUST be resolved so the tag on each item references a valid category name.
- **FR-014**: The 2 `items_sum_mismatch` rows MUST be corrected so `SUM(items.amount) = transaction.amount` for those transactions.

**Audit Script**

- **FR-015**: The audit script's `items_sum_mismatch` check (FR-010 in spec 015) MUST be rewritten to check `SUM(items.effective_amount) + SUM(adjustments) = transaction.amount`, accounting for the signed effect of each adjustment kind.
- **FR-016**: A new audit invariant MUST be added that detects transactions where the arithmetic invariant above is violated (i.e., the adjustment rows and item `effective_amount` values are internally inconsistent).
- **FR-017**: A new heuristic pattern check MUST be added that detects transactions matching the pre-016 fake-refund-as-discount signature: the refund amount is 5%, 10%, 15%, or 20% of the parent, or is a round NT$ amount, and the refund transaction was created within ~5 minutes of the parent.

### Key Entities

- **`transaction_adjustments`**: One row per order-level monetary modifier (fee, refund, or discount) on a transaction. `kind` drives sign. `amount` always positive. `basis` and `basis_value` are annotation-only fields (e.g., "percentage", "10") used for display; they do not affect the stored `amount`.
- **`transaction_items.effective_amount`**: Derived from `transaction.amount` (the authoritative paid total) distributed proportionally across items by item `amount` ratio. Always recomputed app-side; never stored as a permanent fact independent of its inputs.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After migration, the 015 audit script reports `category_tag_on_transaction = 0` (was 15,157).
- **SC-002**: After migration, the 015 audit script reports `fee_refund_without_parent = 0` (was 6, once all 6 have valid parents; orphans are excluded).
- **SC-003**: After migration, the 015 audit script reports `transactions_without_items = 0` (was 6).
- **SC-004**: After migration, the 015 audit script reports `orphan_category_tag_on_item = 0` (was 24).
- **SC-005**: After migration, the 015 audit script reports `items_sum_mismatch = 0` under the rewritten invariant (was 2).
- **SC-006**: After migration, the new audit invariant (items+adjustments sum ≠ transaction.amount) reports 0 violations across all transactions.
- **SC-007**: The category summary correctly attributes spend to categories for any transaction in the dataset — including the 15,157 previously miscategorised legacy records — immediately after migration.
- **SC-008**: A user can record an order-level discount on a new transaction in the PWA without taking more than 3 additional interactions beyond the standard entry flow.
- **SC-009**: No existing non-legacy transaction (source ≠ `legacy_migration`) is modified by the migration.

---

## Assumptions

- **Single user**: This app has one user account. No multi-tenancy or permission boundaries apply to adjustments.
- **`transaction.amount` is authoritative**: The paid total never changes as a side-effect of adding adjustments. Adjustments explain *why* items don't naively sum to it.
- **App-side recompute only**: `effective_amount` is computed in application code on every write. No database triggers, generated columns, or materialised views are used (per data-model principle 5).
- **Display order of stacked adjustments**: Insertion order (no drag-to-reorder needed).
- **NULL item amounts**: Items with `amount = NULL` are skipped during `effective_amount` distribution; this is expected for placeholder/template item rows.
- **Orphan fee/refund rows (no parent)**: The 6 rows with `kind = refund` and no parent transaction cannot be auto-converted. They are surfaced in migration output and left for manual resolution.
- **Invoice-fill conflict**: When an import creates items that disagree with manually entered items, the existing ambiguous-match resolution flow is used unchanged.
- **`basis` / `basis_value` are display annotations**: They do not affect stored `amount` or any computation. They are optional fields used for human-readable context ("10% off").
- **Category name collisions in `orphan_category_tag_on_item`**: The 24 affected items carry tags for category names that don't exist in `categories`. Assumption: each tag maps to an existing category by a known alias or near-match; edge cases will surface during the migration step.
- **Out of scope**: per-item targeted adjustments (`target_item_id`), credit-card cashback (separate event), `v_transactions_full` VIEW (separate future spec), `'point_credit'` enum value (use `note` per principle 6).
