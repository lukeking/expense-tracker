# Quickstart: Item Row Redesign (018)

## Prerequisites

- Dev Supabase migration applied (`018_item_note.sql`)
- `pnpm dev` running in `pwa/`

---

## Step 1: Apply migration

Paste into Supabase SQL Editor:

```sql
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS note TEXT CHECK (char_length(note) <= 200);
```

Verify: `SELECT column_name FROM information_schema.columns WHERE table_name = 'transaction_items' AND column_name = 'note';` → returns 1 row.

---

## Step 2: US1 — Single-item quick entry

1. Open entry form (支出 tab)
2. Confirm one item row is pre-populated
3. Fill amount NT$500
4. Leave item name blank, tap Max → item amount fills to 500
5. Submit → toast "記錄成功"
6. Verify in DB: `SELECT id, amount FROM transactions ORDER BY created_at DESC LIMIT 1` — amount = 500
7. Verify item: `SELECT name, amount, effective_amount FROM transaction_items WHERE transaction_id = '<id>'` — name = null, amount = 500, effective_amount = 500

---

## Step 3: US2 — Multi-item with absolute discount

1. Fill amount NT$450
2. Tap ▾ on amount row to expand adjustments
3. Add discount NT$50
4. Item 1: fill amount NT$300
5. Item 2: tap Max → fills NT$200
6. Reconciliation shows NT$450 ✓ (green)
7. Submit → verify DB: `SELECT SUM(effective_amount) FROM transaction_items WHERE transaction_id = '<id>'` = 450

---

## Step 4: US3 — Single item with % discount (exact)

1. Fill amount NT$180
2. Expand adjustments, add 10% discount
3. Tap Max on item → fills NT$200 (no `≈`)
4. Reconciliation = NT$180 ✓

---

## Step 5: US3 — Single item with % discount (inexact, ≈)

1. Fill amount NT$100
2. Expand adjustments, add 10% discount
3. Tap Max → fills NT$112, `≈` indicator visible
4. Tap − → NT$111, `≈` clears
5. Reconciliation ≈ NT$100 (small diff acceptable)

---

## Step 6: US4 — Adjustments section placement

1. Open entry form fresh
2. Confirm no discount section visible
3. Tap ▾ on amount row → section appears ABOVE items
4. Add a discount row, then collapse → re-expand → row preserved

---

## Step 7: US5 — Per-item note round-trip

1. Fill amount NT$120, item name "拿鐵", note "少冰"
2. Submit
3. Query: `SELECT name, note FROM transaction_items WHERE transaction_id = '<id>'`
4. Expected: name = "拿鐵", note = "少冰"

---

## Step 8: Submit guard

1. Clear all items (remove pre-populated row)
2. Tap submit → blocked (error or toast shown)

---

## Step 9: Backend guard — category tags

1. Submit expense with amount NT$100, no items, free tag "食:晚餐" (bypass via API or dev tools)
2. Verify stored transaction has `tags = []` (category tag stripped)
