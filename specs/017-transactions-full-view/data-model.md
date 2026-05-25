# Data Model: Transactions Full View

## View: `v_transactions_full`

One row per transaction. All fields from the `transactions` table plus two JSON array columns aggregated from child tables.

### Columns

| Column | Type | Source | Notes |
|--------|------|--------|-------|
| `id` | `uuid` | `transactions.id` | Primary key of the transaction |
| `amount` | `integer` | `transactions.amount` | Paid total in NT$ |
| `transaction_type` | `text` | `transactions.transaction_type` | `expense`, `fee`, `refund` |
| `payment_method` | `text` | `transactions.payment_method` | |
| `tags` | `text[]` | `transactions.tags` | Transaction-level tags |
| `note` | `text` | `transactions.note` | nullable |
| `transaction_at` | `timestamptz` | `transactions.transaction_at` | |
| `created_at` | `timestamptz` | `transactions.created_at` | |
| `parent_transaction_id` | `uuid` | `transactions.parent_transaction_id` | nullable |
| `source` | `text` | `transactions.source` | nullable |
| `items` | `json` | aggregated from `transaction_items` | `[]` when no items |
| `adjustments` | `json` | aggregated from `transaction_adjustments` | `[]` when no adjustments |

### `items` array element shape

```json
{
  "id": "uuid",
  "name": "string",
  "amount": 300,
  "effective_amount": 270,
  "tags": ["食:外食"],
  "sort_order": 0
}
```

Ordered by `sort_order` ascending.

### `adjustments` array element shape

```json
{
  "id": "uuid",
  "kind": "discount",
  "amount": 50,
  "note": "LINE點折抵",
  "basis": "percentage",
  "basis_value": 10,
  "source": "manual"
}
```

Ordered by `created_at` ascending.

### Guarantees

- `items` is never NULL — minimum value is `[]`
- `adjustments` is never NULL — minimum value is `[]`
- Read-only — no INSERT / UPDATE / DELETE
- Row count equals `SELECT COUNT(*) FROM transactions`
