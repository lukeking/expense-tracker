# Quickstart: Usable item-level category assignment

How to validate the feature. Backend is covered by automated tests; the PWA (no test runner) is validated by the manual walkthrough.

## 1. Backend automated tests

```bash
cd backend
pnpm test                       # full Vitest workers-pool suite
pnpm test pwa-item-category      # the new PATCH endpoint tests
pnpm test summary                # aggregation regression (spend moves out of 其他)
pnpm test queries                # updateTransactionItemTags + matched-items id shape
```

Expected new/changed coverage:
- **`PATCH /pwa/transactions/:id/items/:itemId`**: assign sets the category tag; reassign replaces it; `null` clears it; plain tags (e.g. `全家`) are preserved; `amount`/`effective_amount` untouched; a `transaction_edit_history` row is written on change and **not** on an idempotent re-assign; `404` for unknown tx/item; `403` for a non-expense tx.
- **`getTransactionItemsByTransactionIds`** selects `id`; `/import/matched` items include `id`.
- **`aggregateByCategory`**: an item moved from `tags: []` to `tags: ['飲食:零食']` shifts its `effective_amount ?? amount` from 其他 to 飲食; the period grand total is unchanged.

## 2. PWA manual walkthrough

```bash
cd pwa && pnpm dev               # then open the app with the API key configured
```

### US1 — searchable / filterable item picker
1. Go to **新增** (EntryScreen), add an item, tap the category control on its left.
2. Confirm the sheet shows **major filter chips** and a **search box** (not one flat list).
3. Type part of a subcategory → only matching `major:sub` options appear (type-ahead).
4. Tap a major → only that major's subcategories show. Pick one → it applies to the item.
5. Confirm **繼承主分類** and **清除** still work.
6. Repeat from **編輯** (EditExpenseSheet) on an existing transaction — same improved sheet.

### US2(a) — import review inline assign
1. Prepare a transaction tagged only `全家` (no category, no items).
2. Import the matching e-invoice CSV (Import screen) so it auto-fills items.
3. In **已配對發票 → 交易品項**, confirm each item shows its category and the auto-filled ones show **⚠ 未分類**.
4. Tap an `未分類` item → the shared sheet opens → pick a category → the flag clears inline (no re-import, no leaving the screen).

### US2(b) — Summary list inline assign (legacy backlog)
1. On **總覽** (SummaryScreen), expand a period/transaction with a legacy `未分類` item.
2. Confirm the item line shows its category or **未分類**.
3. Tap it → shared sheet → assign a category.
4. Confirm the category summary above updates: the item's spend leaves **其他** and lands under the assigned category; the grand total is unchanged.

## 3. Invariants to eyeball (SC-005)

Before/after categorizing any item, the sum of all category totals (including 其他) must equal the period's net total. Categorizing only moves spend between buckets — it never changes the total.
