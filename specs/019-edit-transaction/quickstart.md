# Quickstart: Edit Transaction (019)

## Prerequisites

- Local dev servers running: `wrangler dev` in `backend/`, `vite dev` in `pwa/`
- At least one expense transaction exists in Supabase (can be created via the Entry screen)

## Step 1 — Verify edit entry point (FR-001, SC-004)

1. Open the PWA → tap **統計** (Summary)
2. Expand any time-group that contains transactions
3. Expand a date sub-group
4. Confirm: expense transactions show an **✏ 編輯** button; fee and refund rows do not

## Step 2 — Open and pre-fill (FR-002, SC-002)

1. Tap **✏ 編輯** on an expense transaction
2. Confirm the edit form opens as a full-screen overlay
3. Confirm all fields are pre-filled:
   - Amount matches
   - Payment method pill is selected
   - Category is set (if the original had one)
   - Free tags are listed
   - Transaction note is filled
   - Item rows appear with correct name, amount, tag, and note
   - Adjustments appear (if any)

## Step 3 — Edit and save (FR-003, FR-005, SC-001, SC-003)

1. Change the amount by 100 NT$
2. Add a new item row with a name and amount
3. Tap **儲存**
4. Confirm: toast appears, overlay closes, history list shows updated amount
5. In Supabase SQL Editor, verify:
   - `transactions.amount` is updated
   - `transaction_items` rows for this id reflect the new set
   - `effective_amount` on items is non-null and sums correctly

## Step 4 — Save without changes (FR-003)

1. Open the edit form for the same transaction
2. Tap **儲存** without changing anything
3. Confirm: save succeeds, no data is lost

## Step 5 — Save failure handling (FR-008, SC-005)

1. Stop the backend (`Ctrl+C` on `wrangler dev`)
2. Open edit form, make a change, tap **儲存**
3. Confirm: error message appears; form stays open with unsaved changes
4. Restart backend — save succeeds on retry

## Step 6 — Empty items list (edge case)

1. Open edit form on a transaction with items
2. Remove all item rows
3. Tap **儲存**
4. Confirm: save succeeds; `transaction_items` table has no rows for this id

## Verification queries (Supabase SQL Editor)

```sql
-- Check items and effective amounts after edit
SELECT id, name, amount, effective_amount, note
FROM transaction_items
WHERE transaction_id = '<your-tx-id>'
ORDER BY sort_order;

-- Check adjustments after edit
SELECT kind, amount, note, basis, basis_value
FROM transaction_adjustments
WHERE transaction_id = '<your-tx-id>'
ORDER BY created_at;
```
