# API Contracts — Invoice Reconciliation Enhancements

All endpoints are on the existing auth-gated `pwaRouter` (`authorization` header). Shapes
extend feature 022; only deltas are described.

## US1 — Review queue

### `GET /pwa/import/matched` (modified)
- **Query**: `include_read` (optional, `true` to include acknowledged matches; default
  returns only `reviewed_at IS NULL`).
- **Behavior**: returns matched invoices (unread by default), each with its linked
  transaction. The linked transactions are fetched in **one batched** `.in('id', […])`
  query (replaces the per-invoice N+1).
- **Response**: `{ matched: [{ id, invoice_number, seller_name, invoice_date,
  net_amount, allowance, match_confidence, reviewed_at, items, transaction }] }`.
  `reviewed_at` is exposed so the client can visually distinguish acknowledged rows when
  顯示已讀 is on. `items` is the invoice's line items (which sum to gross — the parser folds
  negative/discount lines into `allowance`); `allowance` lets the client reconcile the
  displayed items back to `net_amount` (`Σ items − allowance = net`). `transaction` carries
  `tags` and its own `items` (name/amount/tags) — all batched (one query each across the
  list) — so a reviewer can judge a match beyond the bare total. SC-002 preserved.

### `POST /pwa/import/mark-read` (new)
- **Body**: `{ invoice_id?: string, invoice_ids?: string[] }` — at least one required.
- **Behavior**: sets `reviewed_at = now()` for the given matched invoice(s). Only affects
  `match_status = 'matched'` rows (ambiguous invoices are not acknowledgeable).
- **Response**: `{ marked: number }`.
- **Errors**: `400 INVALID_PAYLOAD` if neither field provided.

### `POST /pwa/import/rematch` (new)
- **Body**: `{ invoice_id: string }`.
- **Behavior**: like `unlink`, detaches the linked transaction (clears the link, removes
  provenance items, recomputes effective amounts) but — instead of deleting the invoice —
  sets it back to `ambiguous` (clearing `matched_transaction_id` / `match_confidence` /
  `reviewed_at`) so it returns to 待手動確認 for re-linking without a re-import. The
  transaction is never deleted (SC-003).
- **Response**: `{ rematched: { invoice_number, transaction_id } }`.
- **Errors**: `409 INVOICE_NOT_MATCHED` if the invoice isn't currently matched; `400`/`404`
  for bad/absent payload.

## US2 — Discount-aware matching (no new endpoint)

Affects the auto-match step in `runImportPipeline` and the candidate-deriving queries
(`findMatchingExpenseTransaction`). A transaction is a candidate for an invoice when:

```
amount == net_amount  OR  (amount + Σ discount-adjustment values) == net_amount
```

within the existing **±2-day** window. The matched/candidate set is unioned and deduped by
transaction id; **exactly one ⇒ auto-link**, otherwise **ambiguous** (FR-009). Confidence
via existing `computeConfidence` → `near` for any gross-driven match. Transactions without
discount adjustments behave exactly as before (FR-008).

## US3 — Per-item replace in manual link

### `POST /pwa/import/manual-link` (modified)
- **Body** (adds one optional field):
  ```
  {
    invoice_id?: string,            // existing ambiguous invoice, OR
    invoice?: UnmatchedInvoice,     // unmatched payload (+ import_run_id)
    import_run_id?: string,
    transaction_id: string,
    item_indexes?: number[],        // invoice lines to APPEND (existing behavior)
    replace?: { item_id: string, invoice_item_index: number }[]   // NEW
  }
  ```
- **Behavior**: for each `replace` pair, update the existing transaction item (`item_id`)
  **name** to the invoice line (`invoice_item_index`) name; `amount`, `effective_amount`,
  `tags`, and `source_invoice_id` are left unchanged. `replace` and `item_indexes` are
  independent; a given invoice line index is used by at most one of them. No
  `effective_amount` recompute (amounts unchanged).
- **Guards**: existing manual-link guards apply (transaction unlinked; invoice ambiguous
  or not-yet-imported). A `replace` whose `item_id` is not on the chosen transaction →
  `400 INVALID_PAYLOAD`.
- **Response**: unchanged — `{ resolved: MatchedInvoiceDetail }`.
