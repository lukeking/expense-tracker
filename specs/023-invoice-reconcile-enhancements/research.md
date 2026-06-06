# Research — Invoice Reconciliation Enhancements

Phase 0 decisions. The deferred spec clarification (US2 match window + confidence) is
resolved here; the rest pin the smallest mechanics consistent with feature 022.

## US2 — Discount-aware matching: window & confidence

- **Decision**: Reuse the existing exact-match path unchanged in shape — same **±2-day**
  window and same "exactly one candidate ⇒ auto-link, else ambiguous" rule. A transaction
  qualifies as a candidate when `amount == net_amount` **OR** `gross == net_amount`, where
  `gross = amount + Σ(discount-kind adjustments)`. Confidence stays **`near`** for any
  gross-driven match (the existing `computeConfidence` already returns `near` whenever
  `txAmount !== netAmount`, which a gross match always is).
- **Rationale**: Minimal, consistent change; a gross match is by definition not an exact
  paid-amount match, so `near` is the correct existing label — no new confidence value.
- **Alternatives rejected**: a wider/separate window (no reason to differ from exact);
  a new `discount` confidence (redundant with `near`); matching gross *instead of* paid
  (would change behavior for non-discounted txs, violating FR-008).
- **Ambiguity guard**: union the paid-amount and gross candidates, dedup by id; if the set
  size ≠ 1 → `ambiguous` (never silently pick). Preserves SC/FR-009.
- **Scope**: only `discount`-kind adjustments raise the figure; `fee`/`refund` are excluded
  (FR-007 assumption). Transactions with no discount adjustment are unaffected (FR-008).

## US1 — Acknowledged (read) state, filtering, batching

- **Decision**: Add `invoices.reviewed_at timestamptz NULL`. `findAllMatchedInvoices`
  filters `reviewed_at IS NULL` by default; an `includeRead` variant returns all matched
  for the 顯示已讀 toggle. `POST /pwa/import/mark-read` accepts a single `invoice_id` and/or
  an `invoice_ids[]` bulk list → sets `reviewed_at = now()`. Replace the per-invoice
  transaction fetch in `GET /pwa/import/matched` with one `.in('id', [...])` query mapped
  back to invoices.
- **Rationale**: A nullable timestamp is the simplest acknowledged-state representation and
  also records *when*; the unread filter + batched fetch directly deliver SC-002 (<1 s).
- **Alternatives rejected**: a boolean `acknowledged` (timestamp is strictly more useful at
  equal cost); a separate `invoice_reviews` table (over-engineered for a single user —
  violates Simplicity-First).
- **Un-link interaction**: revealed (read) matches still feed the existing un-link action;
  un-link deletes the invoice row (its `reviewed_at` with it), so a later re-match is a
  fresh **unread** match — satisfying the spec's re-match edge case.

## US3 — Per-item replace (rename-only)

- **Decision**: Extend `POST /pwa/import/manual-link` with an optional `replace` list of
  `{ item_id, invoice_item_index }`. For each pair, update the existing transaction item's
  **name** to the invoice line's name; leave `amount`, `effective_amount`, `tags`, and
  `source_invoice_id` untouched. `replace` and the existing `item_indexes` (append) are
  independent; no `effective_amount` recompute is needed (amounts unchanged).
- **Rationale**: Rename-only matches the clarified decision — the recorded amount reflects
  discounts (eco-cup) the invoice's face value doesn't, so only the name is authoritative
  from the invoice.
- **Alternatives rejected**: replace name+amount (invoice face amount ignores discounts);
  blunt replace-all (drags in sibling lines like a pre-paid item); edit-screen-only (user
  wants it in-flow during reconciliation).
- **Provenance note**: a renamed user item keeps `source_invoice_id = NULL` (it's still a
  user item, just renamed), so a later un-link won't delete it — intended (rename ≠ created
  by the invoice).
