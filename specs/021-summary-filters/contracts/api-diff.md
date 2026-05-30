# API Contract Changes — Feature 021

All changes are additive (new optional query params). No breaking changes.

---

## GET /pwa/summary

**New optional params**: `tag` (string), `payment_method` (string)

```
GET /pwa/summary?from=2026-05-01&to=2026-05-31
GET /pwa/summary?from=2026-05-01&to=2026-05-31&tag=lunch
GET /pwa/summary?from=2026-05-01&to=2026-05-31&payment_method=credit_card
GET /pwa/summary?from=2026-05-01&to=2026-05-31&tag=travel&payment_method=cash
```

Response shape unchanged:
```json
{
  "grand_total": 12500,
  "categories": [
    { "category": "食", "total": 5000, "percentage": 40.0 }
  ]
}
```

---

## GET /pwa/transactions

**New optional params**: `tag` (string), `payment_method` (string)

```
GET /pwa/transactions?from=2026-05-01&to=2026-05-31&tag=lunch
GET /pwa/transactions?from=2026-05-01&to=2026-05-31&payment_method=credit_card&limit=300
```

Response shape unchanged.

`payment_method` filter applied at the Supabase query layer (`.eq`).
`tag` filter applied in-Worker after fetch (matches against `tx.tags` union `tx.items[].tags`, plain tags only — excludes `category:sub` format tags).

---

## GET /pwa/summary/subcategories

**New optional params**: `tag` (string), `payment_method` (string)

These are passed through so the drilldown view respects the active filter context.

```
GET /pwa/summary/subcategories?from=2026-05-01&to=2026-05-31&major=食&tag=lunch
```

Response shape unchanged.
