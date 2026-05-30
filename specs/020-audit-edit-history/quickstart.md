# Quickstart: Audit Edit History (020)

## Prerequisites

- Local dev servers running: `wrangler dev` (backend/) + `vite dev` (pwa/)
- At least one expense transaction in the database

## Setup — apply migration

```bash
cd backend
npx supabase migration up   # or apply 019_transaction_edit_history.sql via Supabase Studio
```

Verify:
```sql
SELECT * FROM transaction_edit_history LIMIT 1;
-- Should return empty table, no error
```

## Smoke test

### Step 1 — Open an existing expense

1. Open the PWA, navigate to Summary.
2. Tap ✏ on any expense transaction.
3. Verify: the edit sheet opens. The **edit history section is absent** (no edits yet).

### Step 2 — Make a change and save

1. Change the amount or note on the edit form.
2. Tap 儲存.
3. Verify: the sheet closes (save succeeded).

### Step 3 — Re-open and check history

1. Tap ✏ on the same transaction again.
2. Verify: a **編輯紀錄 (1)** section appears at the bottom of the form.
3. Expand the entry — confirm the `edited_at` timestamp is recent and the diff shows the field(s) you changed with correct before/after values.

### Step 4 — No-op save

1. Open the edit sheet again.
2. Tap 儲存 without changing anything.
3. Re-open the sheet.
4. Verify: history still shows only 1 entry (no-op was not recorded).

### Step 5 — Multiple edits

1. Edit and save the same transaction two more times with different changes.
2. Re-open the sheet.
3. Verify: 3 history entries, ordered oldest-first, each with correct diff.

### Step 6 — DB verification

```sql
SELECT id, transaction_id, edited_at, diff
FROM transaction_edit_history
ORDER BY edited_at;
```

Confirm rows match the edits made above.
