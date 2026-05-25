# Data Model: Transaction Adjustments (016)

## New Table: `transaction_adjustments`

```sql
CREATE TABLE transaction_adjustments (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID         NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  kind           TEXT         NOT NULL CHECK (kind IN ('fee', 'refund', 'discount')),
  amount         INTEGER      NOT NULL CHECK (amount > 0),
  transaction_at TIMESTAMPTZ  NOT NULL,
  basis          TEXT         NULL,
  basis_value    INTEGER      NULL,
  note           TEXT         NULL,
  source         TEXT         NOT NULL DEFAULT 'manual',
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_transaction_adjustments_transaction_id
  ON transaction_adjustments (transaction_id);
```

### Column notes

| Column | Type | Rules |
|--------|------|-------|
| `kind` | TEXT | `'fee'` adds to paid total; `'refund'` and `'discount'` subtract |
| `amount` | INTEGER | Always positive; sign implied by `kind` |
| `transaction_at` | TIMESTAMPTZ | For discounts: same as parent `transaction_at`; for fee/refund: own timestamp |
| `basis` | TEXT | Annotation only — e.g. `'percentage'`, `'absolute'`, `'points'`. Not used in math. |
| `basis_value` | INTEGER | Annotation only — e.g. `10` for "10%", `50` for "NT$50 off". Not used in math. |
| `source` | TEXT | `'manual'` for user-entered; `'legacy_migration'` for migration-converted rows |

### Core math invariant

```
transaction.amount = SUM(items.amount)
                   + SUM(adj.amount WHERE adj.kind = 'fee')
                   - SUM(adj.amount WHERE adj.kind IN ('refund', 'discount'))
```

`transaction.amount` is authoritative (what the user actually paid). Adjustments explain the gap between MSRP item sum and paid total.

---

## Updated Table: `transaction_items`

New column added via migration:

```sql
ALTER TABLE transaction_items
  ADD COLUMN effective_amount INTEGER NULL;
```

### Full shape after 016

```sql
transaction_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id   UUID        NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  amount           INTEGER     NULL,            -- original MSRP/billed price
  effective_amount INTEGER     NULL,            -- NEW: allocated share of paid_total
  tags             TEXT[]      NOT NULL DEFAULT '{}',
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

### effective_amount computation rules

Let:
- `paid_total = transaction.amount`
- `items_total = SUM(item.amount)` (skipping items where amount IS NULL)
- `eligible_items` = items where `amount IS NOT NULL`

For each eligible item `i`:
```
effective_amount_i = floor(item.amount_i × paid_total / items_total)
```

After all items are floored, compute:
```
remainder = paid_total - SUM(floor_values_of_eligible_items)
```

Add `remainder` to the item with the largest `amount` (ties: last by `sort_order`).

Items with `amount = NULL` keep `effective_amount = NULL`.

**Guarantee**: `SUM(effective_amount) WHERE amount IS NOT NULL = paid_total` (exactly, no floating-point residual).

---

## Updated: `transactions` table

No new columns. The existing `amount > 0` check constraint remains unchanged. The schema's enforcement point for FR-018 (`transaction.amount >= 0`) is at the application layer.

---

## TypeScript type additions (`backend/src/types.ts`)

```typescript
export interface TransactionAdjustment {
  id: string;
  transaction_id: string;
  kind: 'fee' | 'refund' | 'discount';
  amount: number;                  // always positive
  transaction_at: string;
  basis: string | null;
  basis_value: number | null;
  note: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

// Updated TransactionItemRow — add effective_amount
export interface TransactionItemRow {
  id: string;
  transaction_id: string;
  name: string;
  amount: number | null;
  effective_amount: number | null;  // NEW
  tags: string[];
  sort_order: number;
  created_at: string;
}
```

---

## Entity relationships

```
transactions (1)
    ├── transaction_items (N)          — items / constituents
    └── transaction_adjustments (N)   — order-level modifiers
```

- A `transaction_adjustments` row always belongs to exactly one `transactions` row.
- CASCADE delete: deleting a transaction deletes its adjustments and items.
- No item-to-adjustment relationship (no `target_item_id` — explicitly out of scope).

---

## Migration numbering

| File | Purpose |
|------|---------|
| `backend/supabase/migrations/015_transaction_adjustments.sql` | Create `transaction_adjustments` table; add `effective_amount` to `transaction_items`; backfill `effective_amount = amount` for all existing items |
| `backend/supabase/migrations/016_summary_rpc_v2.sql` | Replace `get_category_totals` and `get_subcategory_totals` to use `effective_amount` |
| `backend/scripts/migrate-016.ts` | One-time data cleanup: category-tag migration, fee/refund → adjustments, orphan row fixes |
