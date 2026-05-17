# Quickstart: Transaction Items Table

## Prerequisites

- Supabase project accessible with service role key
- `backend/.env` configured
- Existing test data in DB can be dropped (no backward migration)

---

## Step 1: Apply schema migration

```bash
# Drop existing data (test data only — confirmed safe)
# Apply via Supabase dashboard SQL editor or CLI:

# 1. Drop the items JSONB column from transactions
ALTER TABLE transactions DROP COLUMN IF EXISTS items;

# 2. Create transaction_items table
CREATE TABLE transaction_items (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID        NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL,
  amount         INTEGER     NULL,
  tags           TEXT[]      NOT NULL DEFAULT '{}',
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transaction_items_transaction_id ON transaction_items (transaction_id);
```

---

## Step 2: Verify single-item expense (US1 — non-regression)

In Discord:
```
/expense amount:120 description:#食:午餐 便當
```

Expected DB state:
- `transactions`: 1 row, amount=120, tags=[], note=null
- `transaction_items`: 1 row, name=便當, amount=120, tags=[食:午餐]

Expected Discord response:
```
✅ NT$120 [現金]
  · 便當 NT$120
📊 本月支出：$120 / $X,XXX (X%)
```

Run `/summary month` → 食 shows NT$120. ✓

---

## Step 3: Verify multi-item split (US2 — core feature)

```
/expense amount:180 tags:#全家 description:#食:早餐 便當 60,#醫:藥 感冒藥 120
```

Expected DB state:
- `transactions`: amount=180, tags=[全家], note=null
- `transaction_items`: 2 rows
  - {name:便當, amount:60, tags:[食:早餐], sort_order:0}
  - {name:感冒藥, amount:120, tags:[醫:藥], sort_order:1}

Expected Discord response:
```
✅ NT$180 · #全家 [現金]
  · 便當 NT$60
  · 感冒藥 NT$120
📊 本月支出：$XXX / $X,XXX (X%)
```

Run `/summary month` → 食 shows NT$60, 醫 shows NT$120. Total 180. No double-counting. ✓

---

## Step 4: Verify unknown-split falls to 其他 (US3)

```
/expense amount:237 tags:#全家 description:#食:零食 零食,#住:日用品 日用品
```
(no amounts on items)

Expected DB state:
- `transactions`: amount=237, tags=[全家], note=null
- `transaction_items`: 2 rows, both with amount=null
- `/summary month` → 其他 shows NT$237 ✓

---

## Step 5: Verify /amend cascade (US5)

Record: `/expense amount:100 description:#食:午餐 便當`
Then: `/amend amount:110 parent:便當`

Expected: both transaction.amount=110 and item.amount=110. ✓
Run `/summary month` → 食 shows updated NT$110. ✓

---

## Step 6: Verify multi-item amend warns (US5 edge case)

Use the multi-item transaction from Step 3.
Then: `/amend amount:200 parent:便當`

Expected: Discord shows warning "⚠️ 項目金額需手動更新". transaction.amount=200. Item amounts unchanged (60 + 120 = 180 ≠ 200). ✓

Note: search by item name (便當 or 感冒藥), not store tag — `findParentCandidates` searches `note` and `transaction_items.name`, not `tags`.

---

## Step 7: Verify invoice import populates amounts (US4)

**7a — Populate null amounts (item count matches)**:
- Have a transaction with items (no amounts) from Step 4
- Upload `specs/011-transaction-items/invoice_7a_2items.csv` via `/import`
  - Invoice AB12345678: NT$237, 全家, 2 items (零食 NT$97, 日用品 NT$140)
- Expected: item amounts populated — 零食→97, 日用品→140
- `/summary month` → 食 shows NT$97, 住 shows NT$140 ✓

**7b — Replace on count mismatch (warning shown)**:
- Have a fresh transaction with 2 items from Step 4 (零食, 日用品)
- Upload `specs/011-transaction-items/invoice_7b_3items.csv` via `/import`
  - Invoice AB12345679: NT$237, 全家, 3 items (零食 NT$80, 日用品 NT$97, 飲料 NT$60)
- Expected: Discord shows warning listing discarded items (零食, 日用品), then replaces with 3 invoice items ✓
- `/summary month` → amounts under invoice-derived categories ✓

---

## Step 8: Verify forex hold → amend → reconcile

The forex match window is ±5% amount, ±2 days date. An approximate amount lands in the window but not
the exact-match bucket, so the invoice is held until the transaction is corrected.

```
/expense amount:960 note:Airbnb
```

Upload `specs/011-transaction-items/invoice_8_forex.csv` via `/import`
- Invoice AB12345680: NT$1000, Airbnb, 1 item (住宿費 NT$1000)
- NT$960 is within ±5% of NT$1000 (floor(1000×0.95)=950 ≤ 960 ≤ ceil(1000×1.05)=1050) → no exact match → `held_forex`

Expected import summary line: `🔄 外幣待確認：1 筆`

Now amend the transaction to the correct amount:
```
/amend amount:1000 parent:Airbnb
```

Then run:
```
/reconcile
```

Expected reconcile summary: `🔗 外幣已連結：1 筆`

DB state after reconcile:
- `transactions`: amount=1000, note=Airbnb, matched_invoice_id set
- `transaction_items`: 1 row, name=住宿費, amount=1000, tags=[]
- Invoice AB12345680: match_status=matched ✓
