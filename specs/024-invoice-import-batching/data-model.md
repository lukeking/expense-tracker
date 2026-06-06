# Phase 1 Data Model — Invoice Import Batching

**No schema change.** This feature adds no tables, columns, indexes, or DB functions (FR-010). It only changes how existing rows are read and written. The "model" here is the in-memory shape that replaces the per-invoice query loop.

## Touched tables (read/write only — unchanged shape)

| Table | Access in new pipeline |
|-------|------------------------|
| `invoices` | bulk **insert** of matched + ambiguous rows (read ids back); dedup read of existing `invoice_number`s |
| `transactions` | bulk **read** (candidates in union window) + bulk **upsert** (enrichment of matched rows) |
| `transaction_adjustments` | bulk **read** (`kind='discount'` sums for candidate txs) |
| `transaction_items` | bulk **read** (existing items for matched txs → fill vs keep) + bulk **insert** (filled items) |
| `import_runs` | unchanged (`createImportRun`, `updateImportRun`) |

## In-memory structures

- **CandidatePool**: `Transaction[]` — all unmatched expense transactions in `[minInvoiceDate − 7d, maxInvoiceDate + 7d]`. Full rows (needed for the enrichment upsert). Bounded < 1001 by the truncation guard.
- **DiscountSums**: `Map<txId, number>` — Σ of `discount`-kind adjustment amounts per candidate transaction.
- **ConsumedTxIds**: `Set<txId>` — transactions linked earlier in this run; excluded from later invoices' candidate selection (FR-005 / SC-005).
- **MatchedEntry**: `{ invoice: ParsedInvoice; tx: Transaction; confidence: 'exact' | 'near' }` — accumulates the auto-links.
- **AmbiguousEntry**: `ParsedInvoice` — held for manual resolution (≥2 exact/discount candidates, or ≥1 forex candidate when 0 exact).
- **ItemsByTx**: `Map<txId, count>` — existing item counts for matched txs, to decide `filled` (0 existing) vs `kept` (>0).

## Matching rules (unchanged — encoded in the pure matcher)

- **Exact/discount candidate** (±2 days): `tx.transaction_at` within ±2 days of `invoice_date` AND (`tx.amount == net` OR `tx.amount + DiscountSums[tx] == net`), `tx` not consumed.
- **Forex candidate** (±7 days): `tx.transaction_at` within ±7 days AND `floor(net*0.95) ≤ tx.amount ≤ ceil(net*1.05)`, `tx` not consumed.
- **Decision**: 1 exact/discount candidate → auto-link; ≥2 → ambiguous; 0 exact + ≥1 forex → ambiguous; 0 + 0 → skipped_unmatched (no row).
- **Confidence**: `exact` iff same calendar day AND `tx.amount == net`; else `near` (`computeConfidence`, unchanged).

## Write payloads

- **invoices insert** (one multi-row): matched rows carry `match_status='matched'`, `matched_transaction_id`, `match_confidence`; ambiguous rows carry `match_status='ambiguous'`, nulls. Same column set as today's `insertInvoice`.
- **transactions upsert** (one, onConflict `id`): pre-fetched full row + `{ is_matched: true, invoice_number, seller_name, seller_tax_id, matched_invoice_id }`.
- **transaction_items insert** (one multi-row): for matched txs with 0 existing items, the invoice's positive line items mapped with `source_invoice_id = <new invoice id>`, `sort_order` by index (same mapping as `applyInvoiceItems`).

## Invariants (regression bar)

- No `transactions` insert ever occurs (enrichment-only) — asserted via the fake's `calls.insertTransactions === 0`.
- `matched + ambiguous + skipped == total parsed` (summary accounts for 100%).
- A transaction id appears in at most one MatchedEntry per run.
- Outcomes (which invoices match/ambiguous/skip, and confidences) are identical to the pre-change implementation for the same inputs.
