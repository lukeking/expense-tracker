# Phase 0 Research — Invoice Import v2

This feature modifies an existing subsystem (v1 e-invoice import), so "research" is
primarily a behavior diff of the current implementation against the v2 spec, plus the
two scoped decisions resolved during clarification.

## Current (v1) behavior — `runImportPipeline`

Shared by **both** `POST /pwa/import` and the Discord `/import` command.

1. Dedup by `invoice_number` (existing → `skipped_duplicate`).
2. Exact pass: `findMatchingExpenseTransaction` (exact amount, ±2 days, unlinked, expense).
   - 1 candidate → `matched`, enrich tx, `populateItemsFromInvoice`.
   - ≥2 → `ambiguous`.
   - 0 → forex pass.
3. Forex pass: `findForexCandidateTransaction` (±5% amount, ±2 days, unlinked) →
   `held_forex` if any.
4. Still unmatched → **auto-creates a new transaction** (Gemini-parsed tags/items),
   status `auto_created`.
5. `runReconciliationPass`: revisits `held_forex` and `ambiguous` invoices; auto-links
   when candidate count drops to 1, otherwise **auto-creates**.
6. `populateItemsFromInvoice`: if existing item count === invoice positive-item count,
   backfills null amounts; **otherwise replaces** existing items (discarding them).

## Decision 1 — One enrichment-only pipeline; remove Discord import

**Decision**: Rewrite `runImportPipeline` as enrichment-only (no transaction creation,
no reconciliation pass). Delete the Discord `/import` and `/reconcile` commands,
their handlers, and their `register-commands.ts` definitions.

**Rationale**: FR-005 forbids creating transactions under any circumstance, which
removes steps 4–5 entirely. The pipeline was shared, so leaving Discord on the old
behavior would keep auto-create alive on a client the spec scopes out ("PWA is the
only client"). The user chose to collapse to a single path and drop Discord import
rather than maintain two pipelines.

**Alternatives considered**:
- *PWA-only new pipeline, keep v1 for Discord* — rejected: two pipelines to maintain,
  forex/auto-create still live via Discord, contradicts the enrichment-only intent.
- *Replace shared pipeline but keep Discord /import on the new behavior* — rejected by
  the user in favor of removing the Discord command outright (cleanest single path;
  resolution UX moves to the PWA anyway).

## Decision 2 — Keep forex as a candidate source (manual-only)

**Decision**: Primary match is exact net amount within ±2 days (auto-link when exactly
one). When **0 exact candidates** exist, hold the invoice as `ambiguous` if any ±5%
near-amount candidate exists, surfacing those candidates in the manual-resolution UI.
Forex candidates are **never auto-linked**.

**Rationale**: Foreign-currency card transactions post in TWD at a rate that differs
slightly from the invoice total, so exact-amount matching misses them. Dropping forex
entirely (the literal spec reading) would make those invoices permanently
`skipped_unmatched` with no path to enrichment. Routing forex candidates through
manual resolution preserves the capability without auto-linking an inexact amount —
consistent with Constitution IV (auto-match only the unambiguous case; confirm the
rest).

**Alternatives considered**:
- *Drop forex entirely* — rejected by the user: real regression for foreign-currency
  purchases.
- *Auto-link a single forex candidate* — rejected: amount mismatch is inherently
  ambiguous; auto-linking risks wrong enrichment with no undo flow (out of scope).

## Decision 3 — `skipped_unmatched` invoices are not persisted

**Decision**: Invoices with zero candidates (no exact, no forex) are counted in
`skipped_unmatched` but **no invoice row is inserted**.

**Rationale**: FR-007 — "skip invoices with zero candidates without creating any
record." Because dedup keys off invoice-row existence, not persisting these means a
later import re-attempts them once the user has entered the matching transaction —
the desired enrichment behavior. `matched` and `ambiguous` rows *are* persisted, so
they dedup correctly and ambiguous items remain available for resolution.

## Decision 4 — Store confidence as a column, derive at link time

**Decision**: Add `invoices.match_confidence TEXT CHECK (… IN ('exact','near'))`,
set when an invoice becomes `matched` (auto or manual). Confidence is computed from
the matched transaction's date vs the invoice date: same calendar day → `exact`,
within ±2 days otherwise → `near`.

**Rationale**: The summary needs `matched_exact` / `matched_near` breakdowns
(FR-012). Storing it once at link time is cheaper and more stable than recomputing on
every summary read, and keeps `match_status` a single value (`matched`) rather than
splitting the enum. Manual resolutions compute the same way so the summary stays
consistent regardless of how the link was made.

**Alternatives considered**:
- *New `matched_exact` / `matched_near` match_status values* — rejected: pollutes the
  status enum with a second orthogonal axis (confidence); a nullable column is simpler.
- *Derive on read by joining the matched transaction* — rejected: extra join per
  summary, and the tx date could later be edited, silently changing historical
  confidence.

## Decision 5 — Atomicity of resolve without a DB transaction

**Decision**: `POST /pwa/import/resolve` applies writes sequentially with the invoice
status flip **last** (enrich tx → handle items → set invoice `matched`). No Postgres
RPC/transaction is introduced.

**Rationale**: The Supabase JS client offers no easy multi-statement transaction, and
the v1 enrichment path already writes sequentially. For a single-user, low-concurrency
tool, ordering the status flip last makes a mid-way failure recoverable: the invoice
stays `ambiguous` and the user can retry resolve. Introducing an RPC purely for
atomicity would violate Simplicity-First for negligible benefit.

## Unknowns resolved

All NEEDS CLARIFICATION items are resolved; no open unknowns remain for Phase 1.
