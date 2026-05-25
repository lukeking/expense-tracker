# Quickstart: v_transactions_full View

## Prerequisites

- `DATABASE_URL` env var pointing to dev Supabase (postgres connection string)
- `psql` installed, or use Supabase SQL editor

## Apply the migration

```bash
psql $DATABASE_URL -f backend/supabase/migrations/017_transactions_full_view.sql
```

Expected output: `CREATE VIEW`

---

## Verification queries

### 1. Row count matches transactions table

```sql
SELECT
  (SELECT COUNT(*) FROM v_transactions_full) AS view_rows,
  (SELECT COUNT(*) FROM transactions)        AS table_rows;
```

Expected: `view_rows = table_rows`

---

### 2. Known transaction with items + adjustments returns correct arrays

Pick any transaction that has at least one item and one adjustment:

```sql
SELECT id, amount, items, adjustments
FROM v_transactions_full
WHERE jsonb_array_length(items::jsonb) > 0
  AND jsonb_array_length(adjustments::jsonb) > 0
LIMIT 1;
```

Expected: `items` and `adjustments` are non-empty JSON arrays with the documented fields.

---

### 3. Transaction with no items returns `[]` not NULL

```sql
SELECT id, items
FROM v_transactions_full
WHERE jsonb_array_length(items::jsonb) = 0
LIMIT 5;
```

Expected: `items` column shows `[]`, never NULL.

```sql
-- Confirm no NULLs exist
SELECT COUNT(*) AS null_items
FROM v_transactions_full
WHERE items IS NULL;
```

Expected: `0`

---

### 4. Write attempt is rejected

```sql
INSERT INTO v_transactions_full (id, amount) VALUES (gen_random_uuid(), 100);
```

Expected error: `ERROR:  cannot insert into view "v_transactions_full"`

---

### 5. items array element shape

```sql
SELECT
  t.id,
  item->>'id'               AS item_id,
  item->>'name'             AS name,
  (item->>'amount')::int    AS amount,
  (item->>'effective_amount')::int AS effective_amount,
  item->'tags'              AS tags,
  (item->>'sort_order')::int AS sort_order
FROM v_transactions_full t,
     jsonb_array_elements(t.items::jsonb) AS item
LIMIT 10;
```

---

### 6. adjustments array element shape

```sql
SELECT
  t.id,
  adj->>'id'          AS adj_id,
  adj->>'kind'        AS kind,
  (adj->>'amount')::int AS amount,
  adj->>'note'        AS note,
  adj->>'basis'       AS basis,
  adj->>'basis_value' AS basis_value,
  adj->>'source'      AS source
FROM v_transactions_full t,
     jsonb_array_elements(t.adjustments::jsonb) AS adj
LIMIT 10;
```
