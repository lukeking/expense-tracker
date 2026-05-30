# API Contract: Edit Transaction (019)

Auth: `Authorization: Bearer <api_key>` on all routes.

---

## GET /pwa/transactions/:id

Returns full detail for a single transaction, including items with notes and all adjustments.

### Response 200

```json
{
  "id": "uuid",
  "amount": 1200,
  "payment_method": "credit_card",
  "tags": ["brunch"],
  "note": "週末早午餐",
  "transaction_at": "2026-05-30T10:00:00.000Z",
  "transaction_type": "expense",
  "items": [
    {
      "id": "uuid",
      "name": "咖啡",
      "amount": 150,
      "tags": ["food:cafe"],
      "note": "拿鐵",
      "sort_order": 0
    }
  ],
  "adjustments": [
    {
      "id": "uuid",
      "kind": "discount",
      "amount": 100,
      "note": "會員折扣",
      "basis": null,
      "basis_value": null
    }
  ]
}
```

### Errors

| Status | error code | Condition |
|---|---|---|
| 404 | `NOT_FOUND` | No transaction with that id |

---

## PUT /pwa/transactions/:id

Atomically updates the transaction header, replaces all items, replaces all adjustments, and recomputes `effective_amount`.

Only `expense`-type transactions are editable. `transaction_at` and `id` are immutable and ignored in the request body.

### Request body

```json
{
  "amount": 1100,
  "payment_method": "credit_card",
  "category_tag": "food:cafe",
  "free_tags": ["brunch"],
  "note": "週末早午餐",
  "items": [
    {
      "name": "咖啡",
      "amount": 150,
      "tag": null,
      "note": "拿鐵"
    }
  ],
  "adjustments": [
    {
      "kind": "discount",
      "amount": 50,
      "note": "折扣",
      "basis": null,
      "basis_value": null
    }
  ]
}
```

All fields except `amount` and `payment_method` are optional. `items` defaults to `[]` (clearing all items is allowed). `adjustments` defaults to `[]`.

- `item.tag`: per-item category tag override; `null` means inherit `category_tag`
- `item.note`: max 200 chars; empty string normalised to null
- `adj.basis`: `"percentage"` or `null`
- `adj.basis_value`: 1–100 (required when `basis = "percentage"`)

### Response 200

```json
{ "ok": true }
```

### Errors

| Status | error code | Condition |
|---|---|---|
| 400 | `INVALID_AMOUNT` | `amount` not a positive integer |
| 400 | `INVALID_PAYMENT_METHOD` | Unknown payment method |
| 400 | `INVALID_ITEM_AMOUNT` | Item amount not a positive integer |
| 400 | `INVALID_ADJUSTMENT_KIND` | Adjustment kind not `fee`/`refund`/`discount` |
| 400 | `INVALID_ADJUSTMENT_AMOUNT` | Adjustment amount not a positive integer |
| 400 | `INVALID_ADJUSTMENT_BASIS` | `basis` not `"percentage"` or null |
| 400 | `INVALID_ADJUSTMENT_BASIS_VALUE` | `basis_value` out of 1–100 range |
| 403 | `NOT_EXPENSE` | Transaction is not `transaction_type = expense` |
| 404 | `NOT_FOUND` | No transaction with that id |
