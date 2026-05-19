# API Contracts: /pwa/* Routes

**Branch**: `013-pwa-expense-tracker` | **Date**: 2026-05-19

All routes are protected by the existing `androidAuth` middleware:
```
Authorization: Bearer <ANDROID_API_KEY>
```
Missing or incorrect key → `401 { "error": "UNAUTHORIZED" }`.

All request bodies are `application/json` unless noted. All responses are `application/json`.

---

## GET /pwa/categories

Returns all categories grouped for the picker.

**Response 200**
```json
{
  "categories": [
    { "major": "食", "subcategory": null,  "sort_order": 0 },
    { "major": "食", "subcategory": "早餐", "sort_order": 10 },
    { "major": "食", "subcategory": "午餐", "sort_order": 20 },
    { "major": "住", "subcategory": null,  "sort_order": 0 }
  ]
}
```

Rows are ordered by `major ASC, sort_order ASC`. The frontend derives the major list by deduplicating `major` values; subcategories are the rows where `major` matches and `subcategory IS NOT NULL`.

---

## GET /pwa/tags

Returns all distinct plain tags (no `:`) present in `transactions.tags` across the database, for free-tag autocomplete.

**Response 200**
```json
{
  "tags": ["日出好食", "全聯", "711"]
}
```

Tags are returned without the `#` prefix, sorted alphabetically. Category-format tags (containing `:`) are excluded.

---

## POST /pwa/expense

Record a new expense transaction with optional items.

**Request body**
```json
{
  "amount": 100,
  "payment_method": "credit_card",
  "category_tag": "食:早餐",
  "free_tags": ["日出好食"],
  "note": null,
  "items": [
    { "name": "火腿蛋餅", "amount": 40, "tag": null },
    { "name": "蘿蔔糕",   "amount": 40, "tag": null },
    { "name": "大冰紅茶", "amount": 20, "tag": null }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `amount` | integer > 0 | yes | Transaction total in NTD |
| `payment_method` | enum | yes | `cash` \| `credit_card` \| `easy_card` \| `prepaid_wallet` \| `bank_account` |
| `category_tag` | string \| null | no | Tag key from categories table (e.g. `"食:早餐"` or `"食"`). null = no category |
| `free_tags` | string[] | no | Plain tags without `:`. Stored in `transactions.tags` alongside `category_tag` |
| `note` | string \| null | no | Free text |
| `items` | array | no | Empty array or omitted = no items |
| `items[].name` | string | yes | Item name |
| `items[].amount` | integer \| null | no | null = unallocated |
| `items[].tag` | string \| null | no | Per-item tag override. null = inherit `category_tag` |

**Backend logic**:
1. Validate `amount > 0`; validate `payment_method` enum.
2. Validate item amounts: each non-null amount must be > 0.
3. Validate sum: if all item amounts are non-null, sum must not exceed `amount`.
4. Build `transaction.tags = [...free_tags, ...category_tag ? [category_tag] : []]` — wait, actually: `transactions.tags` stores plain tags only; `transaction_items.tags` stores the category tag. Match existing Discord behaviour exactly:
   - `transactions.tags = free_tags`
   - Each item's stored tags = `item.tag ?? category_tag ?? []` (as array)
5. Call `insertTransaction`, then `insertTransactionItems`.

**Response 201**
```json
{
  "id": "uuid",
  "amount": 100,
  "transaction_at": "2026-05-19T10:30:00.000Z"
}
```

**Response 400** — validation error
```json
{ "error": "ITEMS_EXCEED_TOTAL", "message": "Item amounts sum to 120, total is 100" }
```

---

## POST /pwa/fee

Record a foreign transaction fee, optionally linked to a parent expense.

**Request body**
```json
{
  "amount": 30,
  "description": "國外交易服務費",
  "parent_transaction_id": "uuid-or-null"
}
```

| Field | Type | Required |
|-------|------|----------|
| `amount` | integer > 0 | yes |
| `description` | string | yes |
| `parent_transaction_id` | UUID \| null | no |

**Backend logic**: Calls `insertTransaction` with `transaction_type: 'fee'`, `payment_method: 'credit_card'`, `note: description`. If `parent_transaction_id` is provided, calls `updateParentTransactionId`. Inserts one item: `{ name: description, amount, tags: [] }`.

**Response 201**
```json
{ "id": "uuid", "amount": 30, "transaction_at": "..." }
```

---

## POST /pwa/refund

Record a refund, optionally linked to a parent expense.

**Request body**
```json
{
  "amount": 500,
  "description": "退款",
  "payment_method": "credit_card",
  "parent_transaction_id": "uuid-or-null"
}
```

Same as fee but `payment_method` is required and `transaction_type` is `'refund'`.

**Response 201**
```json
{ "id": "uuid", "amount": 500, "transaction_at": "..." }
```

---

## GET /pwa/parent-search

Search for expense transactions to link as a parent for a fee or refund.

**Query params**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `q` | string | required | Search term matched against `note`, item names, and tags |
| `days` | integer \| `"all"` | `90` | How many days back to search |

**Response 200**
```json
{
  "transactions": [
    {
      "id": "uuid",
      "amount": 2800,
      "note": "Google One",
      "transaction_at": "2026-05-10T14:00:00.000Z",
      "item_names": ["Google One 200GB"]
    }
  ]
}
```

Returns up to 5 results ordered by recency.

---

## GET /pwa/summary

Returns category totals for the given date range.

**Query params**

| Param | Type | Required | Notes |
|-------|------|----------|-------|
| `from` | ISO date string | yes | Inclusive start, UTC+8 |
| `to` | ISO date string | yes | Inclusive end, UTC+8 |

**Response 200**
```json
{
  "grand_total": 12450,
  "categories": [
    { "category": "食", "total": 5000, "percentage": 40.2 },
    { "category": "住", "total": 3750, "percentage": 30.1 }
  ]
}
```

Uses the existing `getCategoryTotals` query function. The frontend renders this as the main pie chart.

---

## GET /pwa/summary/subcategories

Returns subcategory totals for a specific major category.

**Query params**

| Param | Type | Required |
|-------|------|----------|
| `from` | ISO date string | yes |
| `to` | ISO date string | yes |
| `major` | string | yes | e.g. `"食"` |

**Response 200**
```json
{
  "major": "食",
  "total": 5000,
  "subcategories": [
    { "subcategory": "早餐", "total": 1800, "percentage": 36.0 },
    { "subcategory": "午餐", "total": 1200, "percentage": 24.0 }
  ]
}
```

Uses the existing `getSubcategoryTotals` query function.

---

## GET /pwa/transactions

Paginated transaction history with items.

**Query params**

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `from` | ISO date | required | |
| `to` | ISO date | required | |
| `category` | string | — | Filter by major category prefix (e.g. `"食"` matches `"食:早餐"`, `"食:午餐"`, `"食"`) |
| `page` | integer | `1` | |
| `limit` | integer | `50` | Max 200 |

**Response 200**
```json
{
  "total": 142,
  "page": 1,
  "transactions": [
    {
      "id": "uuid",
      "amount": 100,
      "transaction_type": "expense",
      "payment_method": "credit_card",
      "tags": ["日出好食"],
      "note": null,
      "transaction_at": "2026-05-17T02:30:00.000Z",
      "items": [
        { "id": "uuid", "name": "火腿蛋餅", "amount": 40, "tags": ["食:早餐"] },
        { "id": "uuid", "name": "蘿蔔糕",   "amount": 40, "tags": ["食:早餐"] },
        { "id": "uuid", "name": "大冰紅茶", "amount": 20, "tags": ["食:早餐"] }
      ]
    }
  ]
}
```

---

## GET /pwa/budget

Returns current month spend vs. budget target.

**Response 200**
```json
{
  "current_spend": 12450,
  "monthly_budget": 20000,
  "percentage": 62
}
```

Uses the existing `getBudgetProgress` function.

---

## POST /pwa/import

Upload and process an e-invoice CSV file.

**Request**: `multipart/form-data` with one field:
- `file`: the CSV file (same format as the Discord `/import` command)

**Response 200**
```json
{
  "filename": "einvoice_202505.csv",
  "matched_count": 12,
  "auto_created_count": 3,
  "skipped_duplicate_count": 1,
  "held_forex_count": 0,
  "ambiguous_count": 0,
  "skipped_voided_count": 2,
  "parse_failed_count": 0
}
```

**Response 400**
```json
{ "error": "INVALID_CSV", "message": "Invalid CSV headers" }
```

**Response 400** — row limit exceeded
```json
{ "error": "ROW_LIMIT_EXCEEDED", "message": "CSV contains 1240 invoices; max is 1000" }
```
