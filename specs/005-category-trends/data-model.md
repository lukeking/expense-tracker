# Data Model: Category Tags & Trend Charts

**Branch**: `005-category-trends` | **Date**: 2026-05-09

## No Schema Changes

This feature introduces **no new tables, columns, or migrations**. All categorisation is derived at read time from the existing `transactions.tags text[]` column.

---

## Existing Entity: Transaction (extended semantics)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `amount` | integer | NTD, no decimals |
| `tags` | text[] | Existing. Now semantically: first element matching `*:*` is the category tag |
| `note` | text | Existing. Now explicitly populated from non-item, non-tag, non-payment tokens |
| `items` | jsonb | Existing. `[{ name: string, amount: number \| null }]` |
| `payment_method` | text enum | Existing. Now set by deterministic keyword match |
| `transaction_type` | text | `'expense'` filtered in summary queries |
| `transaction_at` | timestamptz | Used for period filtering |

---

## New Virtual Concepts (derived, not stored)

### Category
Derived from `tags` at read time:
```
categoryTag = tags.find(t => t.includes(':')) ?? null
category    = categoryTag ? categoryTag.split(':')[0] : '其他'
```

### Subcategory
Derived from the category tag:
```
subcategory = categoryTag ? categoryTag.split(':').slice(1).join(':') : '其他'
```
(Handles multi-colon tags like `食:港式:飲茶` → subcategory = `港式:飲茶`)

### SummaryPeriod
TypeScript union type:
```typescript
type SummaryPeriod = 'month' | 'last-month' | '3months' | 'half-year' | 'year' | 'all';
```

### CategoryTotal
In-memory aggregation result:
```typescript
interface CategoryTotal {
  category: string;   // e.g. '食', '行', '其他'
  total: number;      // sum of transaction amounts in NTD
}
```

### SubcategoryTotal
```typescript
interface SubcategoryTotal {
  subcategory: string;
  total: number;
}
```

---

## Tag Format Conventions

| Input | Stored in `tags` | Category | Subcategory |
|---|---|---|---|
| `#食:午餐` | `['食:午餐']` | 食 | 午餐 |
| `#行:高鐵` | `['行:高鐵']` | 行 | 高鐵 |
| `#食:港式:飲茶` | `['食:港式:飲茶']` | 食 | 港式:飲茶 |
| `#三商巧福` (no colon) | `['三商巧福']` | 其他 | 其他 |
| no `#` token | `[]` | 其他 | 其他 |
| `#食:午餐, #有機` | `['食:午餐', '有機']` | 食 | 午餐 |
