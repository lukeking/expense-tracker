# Data Model: PWA Expense Tracker

**Branch**: `013-pwa-expense-tracker` | **Date**: 2026-05-19

---

## New Entity: Category

Stores the authoritative list of major categories and their subcategories. The frontend reads this table to populate the category picker. No hardcoded categories exist in the frontend.

### Table: `categories`

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, default `gen_random_uuid()` | Surrogate key |
| `major` | TEXT | NOT NULL | Major category label, e.g. `食` |
| `subcategory` | TEXT | NULL | Subcategory label, e.g. `早餐`. NULL = major-only row |
| `sort_order` | INTEGER | NOT NULL, default 0 | Display order within a major group |
| `created_at` | TIMESTAMPTZ | NOT NULL, default `now()` | Audit timestamp |

**Unique constraint**: `(major, subcategory)` — null treated as distinct per SQL standard, so each major has exactly one major-only row.

**Derived tag key**: The tag key stored in `transactions.tags` and `transaction_items.tags` is computed as:
- Major-only row (`subcategory IS NULL`): key = `major` (e.g. `"食"`)
- Major + subcategory row: key = `major || ':' || subcategory` (e.g. `"食:早餐"`)

This matches the existing tag format used by Discord commands exactly.

### Migration: `011_categories.sql`

```sql
CREATE TABLE categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  major        TEXT NOT NULL,
  subcategory  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_category UNIQUE NULLS NOT DISTINCT (major, subcategory)
);

CREATE INDEX idx_categories_major ON categories (major);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO service_role;

-- Seed: initial categories
INSERT INTO categories (major, subcategory, sort_order) VALUES
  ('食', NULL,   0),
  ('食', '早餐', 10),
  ('食', '午餐', 20),
  ('食', '晚餐', 30),
  ('食', '下午茶', 40),
  ('食', '零食', 50),
  ('食', '飲料', 60),
  ('住', NULL,   0),
  ('住', '租金', 10),
  ('住', '水電', 20),
  ('住', '網路', 30),
  ('住', '日用品', 40),
  ('行', NULL,   0),
  ('行', '捷運', 10),
  ('行', '公車', 20),
  ('行', '計程車', 30),
  ('行', '油費', 40),
  ('行', '停車', 50),
  ('育', NULL,   0),
  ('育', '書籍', 10),
  ('育', '課程', 20),
  ('育', '訂閱', 30),
  ('樂', NULL,   0),
  ('樂', '娛樂', 10),
  ('樂', '旅遊', 20),
  ('醫', NULL,   0),
  ('醫', '掛號', 10),
  ('醫', '藥品', 20),
  ('醫', '健身', 30);
```

---

## Existing Entities (unchanged schema, extended usage)

### Transaction

No schema changes. The `tags TEXT[]` column stores the transaction-level category tag key (e.g. `["食:早餐", "日出好食"]`). The `note TEXT` column remains free text. The `payment_method` enum is unchanged.

### Transaction Item

No schema changes. The `tags TEXT[]` column stores the per-item category tag (inherits from transaction if not overridden). The `amount INTEGER NULL` column remains nullable for unallocated items.

### Budget Settings

No schema changes. The PWA Budget screen reads this table via `GET /pwa/budget` (read-only in v1).

---

## Frontend State Model

### Entry Form State

```typescript
interface ExpenseFormState {
  type: 'expense' | 'fee' | 'refund';
  amount: number | '';
  paymentMethod: PaymentMethod;
  selectedMajor: string | null;
  selectedSubcategory: string | null;  // null = major-only tag
  freeTags: string[];                  // plain tags without category
  items: ItemRow[];
  note: string;
}

interface ItemRow {
  id: string;           // client-side uuid for React key
  tagOverride: string | null;  // null = inherit transaction category
  name: string;
  amount: number | null;       // null = unset (displayed as —)
}
```

### Summary State

```typescript
interface SummaryState {
  window: 'month' | 'last-month' | '3months' | 'half-year' | 'year' | 'all';
  drilldownCategory: string | null;  // null = main view
}
```

---

## Tag Compatibility Matrix

| Source | Format stored | Example |
|--------|--------------|---------|
| Discord `/expense tags:#食:早餐,#日出好食` | `transactions.tags = ["日出好食"]`, `transaction_items.tags = ["食:早餐"]` | existing |
| PWA expense, category=食:早餐, freeTags=["日出好食"] | `transactions.tags = ["日出好食"]`, `transaction_items.tags = ["食:早餐"]` | identical |
| PWA expense, no category selected, freeTags=["日出好食"] | `transactions.tags = ["日出好食"]`, `transaction_items.tags = []` | valid |
| PWA expense, category=食 (major only, no subcategory) | `transactions.tags = []`, `transaction_items.tags = ["食"]` | valid — major-only tag |

The summary and drilldown queries group by major category by splitting on `:` — a major-only tag like `"食"` is its own group with no subcategories.
