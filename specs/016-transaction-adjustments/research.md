# Research: Transaction Adjustments (016)

**Status**: Complete — no open questions. All decisions reached through `/speckit-clarify` or inherited from `docs/transaction-adjustments-design.md`.

---

## Decision Log

### D-001: effective_amount recomputation — app-side only

**Decision**: `transaction_items.effective_amount` is computed in application code on every write. No database triggers, generated columns, or materialised views.

**Rationale**: Enforced by project constitution Principle I ("no unnecessary abstractions, fewer moving parts") and Principle V analogy (push complexity to the server layer, not the DB). Confirmed by `docs/data-model-philosophy.md` Principle 5 ("SSOT in base tables; views are read-only; no triggers / generated columns / materialised views").

**Alternatives considered**:
- Postgres trigger: rejected — violates constitution's "no DB-side magic" rule.
- Generated column: rejected — PostgreSQL generated columns can't reference other tables, and can't express the multi-row summation needed here.

---

### D-002: Proportional distribution algorithm

**Decision**: `effective_amount_i = floor(item.amount_i × paid_total / items_total)`. The integer remainder is assigned to the item with the largest `amount` (ties: last by `sort_order`). Items with `amount = NULL` are skipped and their `effective_amount` is left `NULL`.

**Rationale**: Guarantees `SUM(effective_amount) = paid_total` exactly, with no floating-point residual. The largest-item convention is the least-distorting (small fractional errors land in the highest-value item, where they're proportionally smallest). Taken directly from `docs/transaction-adjustments-design.md` §worked-examples.

**Alternatives considered**:
- Round-half-up: leaves a 1-unit discrepancy in edge cases; rejected.
- Distribute equally: wrong for non-uniform item amounts; rejected.

---

### D-003: transaction.amount >= 0 hard invariant

**Decision**: `transaction.amount` must never become negative. The PWA entry and edit forms must validate this before saving (FR-018). The DB's existing `CHECK (amount > 0)` constraint provides the floor at the DB layer.

**Rationale**: Expense tracker records can't have negative paid totals in practice (a full-refund scenario is two transactions, not a negative one). Clarification Q1 — answer A.

**Alternatives considered**:
- Allow negative (warn only): rejected — would require the distribution algorithm to handle negative `effective_amount`, complicating both math and display.

---

### D-004: Orphan fee/refund migration policy (print + continue)

**Decision**: The migration script prints the IDs and amounts of the 6 orphan fee/refund rows (those with no `parent_transaction_id`), then continues executing all remaining migration steps without aborting. These rows are left in the `transactions` table for manual resolution after the migration completes (see spec Post-Migration Manual Steps section).

**Rationale**: These 6 rows should not block the 15,157-row main cleanup. Clarification Q2 — answer B.

**Alternatives considered**:
- Abort on first orphan: blocks the whole migration for an edge case; rejected.
- Interactive per-row prompt: adds complexity and requires TTY; rejected.

---

### D-005: orphan_category_tag_on_item — hard-coded mapping table

**Decision**: The migration script contains a hard-coded `OLD_TAG → NEW_TAG` mapping table (a TypeScript `Record<string, string>`) authored during implementation after inspecting the 24 rows. The mapping requires a code-review pass before execution.

**Rationale**: 24 rows is small enough that a manual mapping is the simplest solution with full audit trail. Clarification Q3 — answer B.

**Alternatives considered**:
- Add `aliases` column to `categories`: schema change for 24 rows of cleanup; over-engineered; rejected.
- Pre-create missing categories: some of the 24 tags may map to existing categories via a name-change; mapping table handles both cases; rejected as secondary approach.

---

### D-006: PWA adjustments UI — collapsible section below items

**Decision**: Adjustments appear in a collapsible section below the items list in both the entry and edit forms, labeled to signal order-level scope (e.g., "折抵 / 手續費 / 退款"). Clarification Q4 — answer B.

**Rationale**: Reinforces the "adjustments are order-level, not item-level" model. Keeps the items section clean. Satisfies SC-008 (≤3 additional interactions).

**Alternatives considered**:
- Inline per-item toggle: semantically misleading; rejected.
- Modal/drawer: extra interaction layer, violates SC-008; rejected.

---

### D-007: source value for migration-created adjustments

**Decision**: Adjustment rows created by the migration (from converting the 6 fee/refund transaction rows) use `source = "legacy_migration"`, matching the original transaction's `source` column value.

**Rationale**: Consistent with how the 015 audit groups data by source. Avoids introducing a new `source` enum value. Clarification Q5 — answer B.

**Alternatives considered**:
- `"manual"`: loses the migrated-vs-user-entered distinction; rejected.
- `"migration_016"`: introduces a new enum value without a compelling reason; rejected.

---

### D-008: Adjustment kind = 'discount' for point credits

**Decision**: Platform point credits (蝦皮幣, LINE點, etc.) use `kind = 'discount'` with a descriptive `note` field. No `'point_credit'` enum value in 016.

**Rationale**: Math is identical to a regular discount. Enum split deferred until there is concrete UI demand. Taken from `docs/transaction-adjustments-design.md` §point-credit.

---

### D-009: Summary RPC aggregation target

**Decision**: Both `get_category_totals` and `get_subcategory_totals` RPCs switch from `SUM(ti.amount)` to `SUM(ti.effective_amount)`. The remainder logic (uncategorised fraction of `transaction.amount`) also uses `effective_amount`.

**Rationale**: Category totals must reflect actually-paid amounts. SC-007 + FR-006 require this.

**Note**: The in-Worker app-side aggregation functions (`aggregateByCategory`, `aggregateBySubcategory` in `backend/src/services/summary.ts`) must be updated in parallel, since the PWA summary screen path uses the RPC, but the Discord summary path uses the app-side functions.

---

### D-010: Migration script pattern

**Decision**: Data migration implemented as a standalone TypeScript script at `backend/scripts/migrate-016.ts`, run via `tsx backend/scripts/migrate-016.ts`. Follows the same pattern as `backend/scripts/audit-legacy.ts`.

**Rationale**: Single-file, no new dependencies, independently runnable, can have a `--dry-run` flag. Already established pattern in the repo.

---

## Technology Decisions (unchanged from existing stack)

| Concern | Decision | Source |
|---------|----------|--------|
| DB | Supabase/PostgreSQL | existing |
| Backend runtime | Cloudflare Workers (Hono) | existing |
| Migration format | `.sql` files in `backend/supabase/migrations/` | existing (001–014) |
| TypeScript runtime (scripts) | `tsx` | existing |
| PWA | React + TypeScript (Vite) | existing |
| Testing | Vitest + `@cloudflare/vitest-pool-workers` | constitution |
