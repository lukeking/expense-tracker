# Feature Specification: Transactions Full View

**Feature Branch**: `017-transactions-full-view`
**Created**: 2026-05-25
**Status**: Draft
**Input**: User description: "Add a v_transactions_full read-only SQL VIEW to Supabase that joins transactions, transaction_items, and transaction_adjustments into a single flat/structured result for easy developer querying and future reporting. The view should expose all key fields: transaction id, amount, transaction_type, payment_method, tags, note, transaction_at, each item's name/amount/effective_amount/tags, and each adjustment's kind/amount/note. No app code changes — schema migration only."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Query Full Transaction Data in One Place (Priority: P1)

A developer or analyst wants to inspect a transaction's complete picture — its header fields, all line items, and all adjustments — without manually joining three tables. They query `v_transactions_full` and immediately get a structured result.

**Why this priority**: The sole purpose of the view. Without this, the feature has no value.

**Independent Test**: Run `SELECT * FROM v_transactions_full WHERE id = '<known-id>'` against dev Supabase and confirm the result includes transaction fields, item rows, and adjustment rows for that transaction.

**Acceptance Scenarios**:

1. **Given** a transaction with 2 items and 1 adjustment exists, **When** a developer queries `v_transactions_full` filtered by that transaction's id, **Then** the result includes the transaction header fields, both items (name, amount, effective_amount, tags), and the adjustment (kind, amount, note).
2. **Given** a transaction with no items and no adjustments exists, **When** queried via `v_transactions_full`, **Then** the result includes the transaction header fields with null/empty item and adjustment arrays.
3. **Given** `v_transactions_full` exists, **When** a developer runs any write operation (INSERT/UPDATE/DELETE) on it, **Then** the operation is rejected — the view is read-only.

---

### Edge Cases

- Transaction with items but no adjustments: item arrays populated, adjustment arrays empty.
- Transaction with adjustments but no items: edge case that should not occur after 016 migration, but view must handle gracefully (null item fields or empty array).
- Transaction with multiple adjustments of the same kind: all rows appear.
- Transactions with NULL `note`, NULL `effective_amount`, or empty `tags[]`: NULLs pass through correctly.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A read-only view named `v_transactions_full` MUST be created in the database, accessible to the service role.
- **FR-002**: The view MUST expose transaction-level fields: `id`, `amount`, `transaction_type`, `payment_method`, `tags`, `note`, `transaction_at`, `created_at`, `parent_transaction_id`, `source`.
- **FR-003**: The view MUST aggregate all associated items into a JSON array column `items`, where each element includes: `id`, `name`, `amount`, `effective_amount`, `tags`, `sort_order`.
- **FR-004**: The view MUST aggregate all associated adjustments into a JSON array column `adjustments`, where each element includes: `id`, `kind`, `amount`, `note`, `basis`, `basis_value`, `source`.
- **FR-005**: Transactions with no items MUST appear in the view with an empty `items` array (not NULL, not excluded).
- **FR-006**: Transactions with no adjustments MUST appear in the view with an empty `adjustments` array.
- **FR-007**: The view MUST be implemented as a single SQL migration file; no application code changes are permitted.
- **FR-008**: The view MUST use `json_agg` / `jsonb_agg` (or equivalent) with `ORDER BY sort_order` for items and `ORDER BY created_at` for adjustments so results are deterministic.

### Key Entities

- **`v_transactions_full`**: Read-only view; one row per transaction; `items` and `adjustments` are JSON arrays embedded in the row.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Querying `v_transactions_full` for a known transaction with items and adjustments returns all fields in a single row with no missing data.
- **SC-002**: Querying `v_transactions_full` for a transaction with no items returns an empty `items` array (not NULL, not absent).
- **SC-003**: Any write attempt against the view is rejected by the database.
- **SC-004**: The view covers 100% of existing transactions — `SELECT COUNT(*) FROM v_transactions_full` equals `SELECT COUNT(*) FROM transactions`.

## Assumptions

- Service role has SELECT access on all three underlying tables (already true).
- No application code (backend worker, PWA) needs to be updated — consumers are developer SQL queries and future reporting tools.
- Performance is not a concern for v1 — the view is for ad-hoc developer queries, not high-frequency app paths.
- Row-level security (RLS) on the underlying tables is not bypassed by the view; the view inherits existing security policies.
