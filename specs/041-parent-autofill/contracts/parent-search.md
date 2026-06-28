# Contract: GET /pwa/parent-search (extended)

**Feature**: 041-parent-autofill | **Date**: 2026-06-28

Extends the existing endpoint. Request is unchanged; the response gains two fields per candidate. No new endpoint, no new query parameter, no DB change.

## Request (unchanged)

```
GET /pwa/parent-search?q=<term>&days=<90|all>
```

- `q` (required): search term matched against item names, item-level tags, the note, and transaction-level tags.
- `days` (optional, default `90`): `all` widens the window; otherwise a day count.
- Candidate set: `expense` and `fee` transactions in the window (refunds are never parents), max 5, newest first — unchanged.

## Response

```jsonc
{
  "transactions": [
    {
      "id": "uuid",
      "amount": 1280,
      "note": "iherb 訂單",
      "tags": ["食:保健", "iherb"],
      "transaction_at": "2026-06-20T03:11:00.000Z",
      "item_names": ["維他命 D", "魚油"],
      "payment_method": "credit_card",   // NEW
      "category": "食:保健"               // NEW — single 主:子 tag, or null
    }
  ]
}
```

### New field semantics

| Field | Type | Rule |
|---|---|---|
| `payment_method` | `"cash" \| "credit_card" \| "easy_card" \| "prepaid_wallet" \| "bank_account"` | The candidate transaction's payment method (transaction-level column). Always present. |
| `category` | `string \| null` | The single distinct `主:子` category tag across the candidate's `tags` + all item `tags`. `null` when there are zero colon-tags (uncategorized) or more than one distinct colon-tag (ambiguous). |

### Category resolution (authoritative)

```
distinct( [...tags, ...items.flatMap(i => i.tags)].filter(t => t.includes(':')) )
  size 1 → that tag
  else   → null
```

- Mirrors the existing `enrichRefundTags` colon-tag detection, but uses an exactly-one-distinct test (per spec FR-004).
- A fee candidate always has a single `category_tag` → returns it.
- A feature-027 "B2" expense (tx-level SSOT category, inherited by items) → returns the one tag.
- A legacy multi-category expense → `null`.

## Backwards compatibility

Additive only. Existing consumers that ignore the two new fields are unaffected. The PWA `ParentSearchResult` type adds `payment_method: string` and `category: string | null`.

## Test assertions (Vitest worker)

1. A candidate with a single category (fee, or B2 expense) → response `category` equals that `主:子` tag.
2. A candidate with multiple distinct item categories → response `category` is `null`.
3. A candidate with no colon-tag → response `category` is `null`.
4. Every candidate carries a valid `payment_method` matching the stored transaction.
