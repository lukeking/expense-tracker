# Research: Transactions Full View

## Decision 1 — Correlated subqueries vs LEFT JOIN + GROUP BY

**Decision**: Use correlated subqueries for each JSON array column.

**Rationale**: A LEFT JOIN between `transactions`, `transaction_items`, and `transaction_adjustments` produces a cross product — a transaction with 2 items and 3 adjustments yields 6 rows. Deduplication with `DISTINCT` inside `json_agg` is fragile and fails when rows are identical. Correlated subqueries (`SELECT json_agg(...) FROM transaction_items WHERE transaction_id = t.id`) are clean, correct, and PostgreSQL optimises them well at this data scale (~15k transactions).

**Alternatives considered**: LEFT JOIN + GROUP BY with `DISTINCT jsonb_build_object(...)` — rejected due to fragility with duplicate rows and harder-to-read SQL.

---

## Decision 2 — `json_agg` vs `jsonb_agg`

**Decision**: Use `json_agg` with `jsonb_build_object` inside.

**Rationale**: `jsonb_build_object` produces `jsonb`; wrapping in `json_agg` (which casts to `json`) is fine — the result is consistent text-serialised JSON. Using `jsonb_agg` would return `jsonb` arrays, which behaves the same for consumers. Either works; `json_agg` is conventional in this codebase (existing RPCs use it).

---

## Decision 3 — Empty array fallback

**Decision**: `COALESCE(..., '[]'::json)` for both `items` and `adjustments`.

**Rationale**: When no items or adjustments exist, `json_agg` returns NULL. The spec requires `[]` (not NULL) for empty arrays so consumers can iterate without null-checks. `COALESCE` is the standard PostgreSQL pattern for this.

---

## Decision 4 — `CREATE OR REPLACE VIEW` vs `CREATE VIEW`

**Decision**: `CREATE OR REPLACE VIEW`.

**Rationale**: Idempotent — safe to re-run the migration file. If the view definition needs to change in a future feature, the same pattern applies without needing a DROP first.
