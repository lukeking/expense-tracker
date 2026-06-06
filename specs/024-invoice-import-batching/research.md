# Phase 0 Research — Invoice Import Batching

All spec-level unknowns were resolved during `/speckit-clarify` (subrequest budget, write strategy, truncation handling). This document records the remaining implementation-level decisions.

## Decision 1 — Single union window for the candidate fetch

**Decision**: Fetch unmatched expense transactions once over `[min(invoice_date) − 7 days, max(invoice_date) + 7 days]`, then apply the per-rule windows (±2-day exact/discount, ±7-day forex) in memory per invoice.

**Rationale**: The forex rule already uses the widest window (±7 days), so one fetch at ±7 days is a superset of every per-invoice need. Amount can't be bounded in SQL because each invoice has a different net, so the amount filter also moves in-memory. This is one query regardless of invoice count.

**Alternatives considered**:
- *Per-invoice windowed queries (today)* — rejected: this is the bug (subrequests scale with N).
- *One query per distinct invoice date* — rejected: still scales with date spread; the union window is strictly simpler.

## Decision 2 — Truncation detection

**Decision**: Request the candidate read with an explicit limit of `MAX_PAGE + 1` (i.e. 1001). If more than `MAX_PAGE` (1000) rows return, throw a clear error and abort the import before any matching or writes (FR-012).

**Rationale**: Supabase/PostgREST caps a single response at ~1000 rows. Requesting 1001 distinguishes "exactly 1000 and complete" from "more than 1000 and truncated" without a count query. Aborting loudly beats silently matching a partial candidate set (which would violate FR-003). For this dataset the guard effectively never fires.

**Alternatives considered**:
- *Full pagination loop* — rejected for now (clarification chose simplicity); the guard makes the assumption safe and paging can be added later if it ever fires.
- *`HEAD` count query first* — rejected: an extra subrequest and a TOCTOU gap for no real benefit at this scale.

## Decision 3 — Bulk transaction enrichment via upsert of pre-fetched full rows

**Decision**: Enrich matched transactions with a single `upsert` on `transactions` keyed by `id`. The payload is each matched transaction's **full pre-fetched row** merged with the enrichment fields (`is_matched`, `invoice_number`, `seller_name`, `seller_tax_id`, `matched_invoice_id`).

**Rationale**: PostgREST upsert issues `INSERT ... ON CONFLICT (id) DO UPDATE`, which requires all NOT-NULL columns be present in the payload. Because this feature already pre-fetched the complete candidate rows, we have exactly that data — so a single upsert updates all matched rows in one subrequest with no new DB object (honoring FR-008/FR-010). Rows never actually insert (ids already exist); the conflict path updates only the changed columns.

**Alternatives considered**:
- *N per-row `update().eq('id', …)` (today)* — rejected: scales with match count, breaches the ~50 budget.
- *Postgres RPC / stored function* — rejected in clarification: more robust but adds a migration; not needed since the client has the full rows.

## Decision 4 — Discount fetch scope

**Decision**: Fetch `kind='discount'` adjustments in one query for the candidate transactions whose `amount` is below the batch's maximum invoice net (only those can need a discount to reach a net). Sum per transaction into a `Map<txId, number>`.

**Rationale**: One subrequest; restricting to below-max-net candidates keeps the `IN (…)` id list small in practice. The truncation guard already bounds total candidates < 1001, so the id list is bounded. Mirrors the current discount-aware semantics (`amount + Σdiscount == net`) exactly.

**Alternatives considered**:
- *Per-invoice discount query (today)* — rejected: the exact subrequest blowup in the screenshot (`findMatchingExpenseTransaction discounts`).
- *Embedded resource filter (`transaction_adjustments?...&transactions.transaction_at=…`)* — viable and avoids a long id list, but adds reliance on the PostgREST FK embed; kept as a fallback if the `IN` list ever grows too large for the URL.

## Decision 5 — Behavior parity is order-preserving

**Decision**: Iterate invoices in the same input order as the current pipeline and track consumed transactions in a `Set`. An exact/discount match of length 1 consumes its transaction; ambiguous and skipped consume nothing.

**Rationale**: Today, linking a transaction sets `matched_invoice_id`, so the next invoice's query excludes it. An in-memory consumed-set in input order reproduces this precisely (FR-005, SC-005). Candidate ordering does not affect the length-based match/ambiguous decision, so dropping the SQL `ORDER BY` changes no outcome.

## Decision 6 — Scope of `GET /import/ambiguous`

**Decision**: Refactor the ambiguous-list endpoint in the same feature to pre-fetch candidates once and reuse the new pure matcher (plus a batched per-candidate item fetch), instead of re-deriving per invoice with per-candidate item reads.

**Rationale**: It is the same N+1 anti-pattern on the same functions and the same user-facing surface immediately after an import; FR-002 applies to it. Doing it now is cheap once the pure matcher and bulk fetch exist. Tracked as a separate task so it can be deferred if desired.

## Decision 7 — Test harness extension

**Decision**: Extend the in-memory fake Supabase in `invoice-matcher.test.ts` to support `.upsert()` (treat as insert-or-update by `id`) and explicit `.limit()`/`.range()` for the truncation case. Keep the existing `calls.insertTransactions` assertion (no transaction ever created).

**Rationale**: The fake runs the real pipeline end-to-end, so it must speak the new chainable verbs. Behavior parity (SC-003) is proven by the existing suite passing unchanged plus new cases for the consumed-set, discount-gross, truncation guard, and bulk-write shape.
