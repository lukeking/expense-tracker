# Data Model — Invoice Reconciliation Enhancements

Only one schema change (US1). US2 and US3 reuse existing structures.

## Changed

### `invoices` (+ one column)

| Field | Type | Notes |
|-------|------|-------|
| `reviewed_at` | `timestamptz NULL` | **New.** `NULL` = unacknowledged (shows in the review list); set = acknowledged (hidden by default, revealed via 顯示已讀). Set by mark-as-read; cleared implicitly when the invoice row is deleted on un-link. |

All other `invoices` fields (match_status, match_confidence, matched_transaction_id,
items, …) are unchanged. Acknowledged state applies only to `match_status = 'matched'`
rows; `ambiguous` rows are never acknowledged (FR-005).

## Reused (no change)

### `transactions`
- `amount` — the **paid** amount. Used as today for the paid-amount match.

### `transaction_adjustments`
- A `discount`-kind adjustment's value contributes to the **gross** figure used by
  discount-aware matching: `gross = amount + Σ(discount adjustment values)`.
- `fee` and `refund` kinds are **excluded** from the gross figure (FR-007 scope).

### `transaction_items`
- Per-item replace updates an item's **`name`** only; `amount`, `effective_amount`,
  `tags`, and `source_invoice_id` are preserved.
- A renamed user item keeps `source_invoice_id = NULL` (still user-owned, just renamed),
  so un-link does not delete it.

## Migration

`backend/supabase/migrations/022_invoice_reviewed_at.sql`:

```sql
ALTER TABLE invoices ADD COLUMN reviewed_at TIMESTAMPTZ;
```

(Optional, only if the matched-list query ever shows latency at scale: a partial index
`CREATE INDEX ... ON invoices (match_status) WHERE reviewed_at IS NULL;` — omitted by
default per Simplicity-First; the single-user volume does not warrant it.)

## State notes

- **Acknowledgement is one-way** within this feature: there is no "mark as unread". A
  re-match after un-link produces a new row with `reviewed_at = NULL`.
- **Enrichment-only invariant** (SC-003) holds: none of these touch the `transactions`
  row count.
