# Phase 1 Contracts: Usable item-level category assignment

Two changes. One **new** endpoint; one **additive** field on an existing response. No breaking changes; no change to request shapes of existing endpoints.

---

## NEW — `PATCH /pwa/transactions/:id/items/:itemId`

Assign, reassign, or clear a single transaction item's category. Behind the existing PWA API-key auth.

### Request
```
PATCH /pwa/transactions/{txId}/items/{itemId}
Content-Type: application/json

{ "category_tag": "飲食:零食" }     // a major:sub, a bare major, or null to clear/inherit
```

### Behavior
- Loads the transaction; `404 NOT_FOUND` if the tx or item does not exist.
- `403 NOT_EXPENSE` if `transaction_type !== 'expense'` (mirrors `PUT /transactions/:id`).
- `400 INVALID_PAYLOAD` if body is not JSON; `400 INVALID_CATEGORY_TAG` if `category_tag` is neither a non-empty string nor `null`.
- New tags = `currentTags.filter(t => !t.includes(':'))` then append `category_tag` when non-null (D7).
- Writes only `transaction_items.tags`; does **not** touch `amount` / `effective_amount`.
- Appends a `transaction_edit_history` row when the items diff is non-empty (D4); idempotent re-assign writes nothing.

### Response
```
200 { "ok": true }
```

### Notes
- Catalog membership is **not** enforced (consistent with `PUT`, which stores whatever `tag` the client sends) — the PWA picker constrains choices; off-catalog existing tags stay assignable (FR-005).
- No `effective_amount` recompute (D2): period total is invariant, only the category split moves.

---

## CHANGED — `GET /pwa/import/matched` (additive)

Each `transaction.items[]` entry gains an `id` so the import review can target the inline PATCH.

### Before
```json
"transaction": { "...": "...", "items": [ { "name": "冰棒", "amount": 25, "tags": [] } ] }
```

### After
```json
"transaction": { "...": "...", "items": [ { "id": "uuid", "name": "冰棒", "amount": 25, "tags": [] } ] }
```

Backed by adding `id` to `getTransactionItemsByTransactionIds`'s select (and its `Pick<>` return type) and including it in the mapping at `pwa.ts:924-928`. Purely additive — existing consumers ignore the extra field.

---

## Unchanged (explicitly)

- `GET /pwa/transactions` already returns `items[].id` + `tags` — the Summary surface needs no API change.
- `GET /pwa/summary` / `…/subcategories` response shapes are unchanged; only the numbers shift as items get categorized.
- The category catalog endpoint `GET /pwa/categories` is reused as-is by `ItemCategorySheet`.
