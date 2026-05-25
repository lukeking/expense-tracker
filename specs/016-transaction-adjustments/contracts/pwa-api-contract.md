# PWA API Contract — Spec 016

Changes to the HTTP API exposed by the Cloudflare Worker (`backend/src/handlers/pwa.ts`).

---

## Modified: POST /pwa/expense

Existing endpoint for creating an expense transaction. The request body gains an optional `adjustments` array.

### Request body (additions in bold)

```json
{
  "amount": 450,
  "payment_method": "credit_card",
  "category_tag": "食:餐廳",
  "free_tags": [],
  "note": "義大利麵",
  "items": [
    { "name": "義大利麵", "amount": 300, "tag": null },
    { "name": "飲料", "amount": 200, "tag": null }
  ],
  "adjustments": [
    {
      "kind": "discount",
      "amount": 50,
      "note": "LINE點折抵",
      "basis": "absolute",
      "basis_value": 50
    }
  ]
}
```

### `adjustments` array element

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `kind` | `"fee"` \| `"refund"` \| `"discount"` | yes | |
| `amount` | integer > 0 | yes | Always positive |
| `note` | string \| null | no | Human-readable label |
| `basis` | string \| null | no | `"percentage"` \| `"absolute"` \| `"points"` — annotation only |
| `basis_value` | integer \| null | no | e.g. `10` for "10%", `50` for "NT$50" — annotation only |

### Validation (server-side, enforced before DB write)

- `adjustments[].amount > 0` — positive amounts only.
- `transaction.amount >= 1` — the submitted `amount` must be positive (DB constraint).
- `effective_amount` is computed server-side and written to `transaction_items`; it is never sent from the client.

### Response

No change to the existing success/error shape.

---

## Modified: POST /pwa/expense (edit flow — TBD route)

The edit flow (if exposed as a separate endpoint) accepts the same `adjustments` array. If a transaction already has adjustments, the edit handler replaces them (delete-all + re-insert pattern). `effective_amount` is recomputed for all items on every edit.

---

## No new endpoints

All adjustment management happens through the existing expense POST and the edit flow. No standalone CRUD for `transaction_adjustments`.

---

## Backend: effective_amount write helper

New reusable function in `backend/src/db/queries.ts`:

```typescript
async function computeAndWriteEffectiveAmounts(
  supabase: SupabaseClient,
  transactionId: string,
  paidTotal: number
): Promise<void>
```

Reads all `transaction_items` for the transaction (only those with `amount IS NOT NULL`), computes `effective_amount` via the floor + remainder algorithm, and bulk-updates the column. Called after any write to `transaction_items` or `transaction_adjustments`.
