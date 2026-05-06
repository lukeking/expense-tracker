# Data Model: Expense Tracker

**Branch**: `001-expense-tracker` | **Date**: 2026-05-05 (updated 2026-05-06)

## Overview

Single-user schema hosted on Supabase (PostgreSQL). No user_id partitioning. All writes go through the CF Worker (service role key). Android interacts only through the CF Worker API.

---

## Entities

### `transactions`

The primary ledger record. Created from two sources: (a) Discord manual input, or (b) Android notification listener. May be later enriched with receipt data from 財政部 API.

```sql
CREATE TABLE transactions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount             INTEGER NOT NULL,               -- NTD, no decimals
  items              JSONB,                          -- [{name: text, amount: integer}]
  tags               TEXT[] DEFAULT '{}',            -- freeform: ["food", "transport"]
  payment_method     TEXT NOT NULL,                  -- see Payment Method table below
  wallet             TEXT,                           -- mobile app used: 'line_pay' | 'google_pay' | null
  bank_name          TEXT,                           -- from Android notification, e.g. "玉山銀行"
  note               TEXT,                           -- optional freeform note
  is_matched         BOOLEAN NOT NULL DEFAULT FALSE, -- matched with a 財政部 receipt
  matched_receipt_id UUID REFERENCES receipts(id),   -- set when matched
  parent_transaction_id UUID REFERENCES transactions(id), -- set for linked fee records (e.g. 國外交易服務費)
  discord_message_id TEXT,                           -- Discord message ID for later PATCH edits
  transaction_at     TIMESTAMPTZ NOT NULL,           -- when the purchase occurred
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_payment_method CHECK (
    payment_method IN ('credit_card', 'prepaid_wallet', 'easy_card', 'bank_account', 'cash')
  ),
  CONSTRAINT chk_wallet CHECK (
    wallet IS NULL OR payment_method IN ('credit_card', 'prepaid_wallet')
  )
);

CREATE INDEX idx_transactions_transaction_at ON transactions (transaction_at DESC);
CREATE INDEX idx_transactions_is_matched ON transactions (is_matched) WHERE is_matched = FALSE;
```

**Payment method values**:

| `payment_method` | `wallet` | Auto-capture | Description |
|---|---|---|---|
| `credit_card` | `null` / `'line_pay'` / `'google_pay'` | ✅ Bank push | Direct credit card or mobile-wallet-backed credit charge |
| `prepaid_wallet` | `'line_pay'` / `'google_pay'` | ✅ App push | Mobile wallet prepaid balance (e.g. LINE Pay Money) |
| `easy_card` | `null` | ❌ Manual only | EasyCard actual spending; auto top-up is ignored |
| `bank_account` | `null` | ⚠️ Bank push | Online transfer / direct debit payment |
| `cash` | `null` | ❌ Manual only | Cash payment |

**Validation rules**:
- `amount` must be > 0
- `payment_method` must be one of the five values above
- `wallet` must be `null` unless `payment_method` is `credit_card` or `prepaid_wallet`
- `matched_receipt_id` set → `is_matched` must be `true`
- `items` array elements must have `name` (string) and `amount` (positive integer)

**Multi-app notification deduplication**:

The same purchase may trigger multiple push notifications within ~3 minutes from different apps (e.g. 玉山銀行 + 玉山Wallet + LINE Pay). The backend handles this with an **upsert** strategy:
- Match condition: `amount` equal AND `created_at` within 3 minutes of existing transaction
- First notification → `INSERT`, return `201`
- Subsequent notifications (same window) → `UPDATE` only `NULL` fields (`bank_name`, `wallet`), return `200` with existing `transaction_id`
- `bank_name` is NOT used as a dedup key (differs across app notifications)

**Android parser ignore list** (not forwarded to backend):
- EasyCard auto top-up: notification contains `自動加值` / `自動補值`
- ATM cash withdrawal: notification contains `提款` / `提現` / `ATM`
- Non-spending bank alerts (balance queries, bill reminders)

**State transitions**:
```
UNMATCHED (is_matched=false, matched_receipt_id=null)
  → [auto-match by amount+date] → MATCHED (is_matched=true, matched_receipt_id=<UUID>)
  → [ambiguous: multiple candidates] → PENDING_CONFIRM (flagged via Discord message, user confirms)
```

---

### `receipts`

Invoice records fetched from 財政部電子發票平台. Stored raw + structured for matching.

```sql
CREATE TABLE receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT NOT NULL,            -- e.g. "AB12345678" (字軌 + serial)
  random_code     TEXT NOT NULL,            -- 隨機碼: 4-char anti-forgery code from MOF
  seller_name     TEXT NOT NULL,
  seller_tax_id   TEXT NOT NULL,            -- 統一編號
  total_amount    INTEGER NOT NULL,         -- NTD
  items           JSONB NOT NULL,           -- [{name, count, unit_price, amount}]
  invoice_date    DATE NOT NULL,
  carrier_type    TEXT NOT NULL DEFAULT 'mobile_barcode',
  raw_data        JSONB NOT NULL,           -- original API response for auditability
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_receipt UNIQUE (invoice_number, invoice_date, seller_tax_id, random_code)
  -- invoice_number alone can recur across MOF 2-month allocation periods;
  -- the composite key covers period (invoice_date), issuer (seller_tax_id),
  -- and per-document uniqueness (random_code).
);

CREATE INDEX idx_receipts_invoice_date ON receipts (invoice_date DESC);
CREATE INDEX idx_receipts_total_amount ON receipts (total_amount);
```

---

### `budget_settings`

Single row (id=1) storing the current monthly budget target.

```sql
CREATE TABLE budget_settings (
  id             INTEGER PRIMARY KEY DEFAULT 1,
  monthly_budget INTEGER NOT NULL DEFAULT 20000,  -- NTD
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO budget_settings (id, monthly_budget) VALUES (1, 20000)
  ON CONFLICT (id) DO NOTHING;
```

---

### `pending_matches`

Tracks ambiguous match states where multiple receipts share the same amount in the time window.

```sql
CREATE TABLE pending_matches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  candidate_ids   UUID[] NOT NULL,          -- receipt IDs that are candidates
  discord_message_id TEXT,                  -- the Discord message prompting user to confirm
  resolved        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## TypeScript Types

```typescript
// src/types.ts

export type PaymentMethod = 'credit_card' | 'prepaid_wallet' | 'easy_card' | 'bank_account' | 'cash';
export type MobileWallet = 'line_pay' | 'google_pay';

export interface TransactionItem {
  name: string;
  amount: number;
}

export interface Transaction {
  id: string;
  amount: number;
  items: TransactionItem[] | null;
  tags: string[];
  payment_method: PaymentMethod;
  wallet: MobileWallet | null;
  bank_name: string | null;
  note: string | null;
  is_matched: boolean;
  matched_receipt_id: string | null;
  parent_transaction_id: string | null;
  discord_message_id: string | null;
  transaction_at: string; // ISO 8601
  created_at: string;
}

export interface ReceiptItem {
  name: string;
  count: number;
  unit_price: number;
  amount: number;
}

export interface Receipt {
  id: string;
  invoice_number: string;
  random_code: string;    // 隨機碼: 4-char anti-forgery code
  seller_name: string;
  seller_tax_id: string;
  total_amount: number;
  items: ReceiptItem[];
  invoice_date: string; // YYYY-MM-DD
  carrier_type: string;
  raw_data: unknown;
  fetched_at: string;
  created_at: string;
}

export interface BudgetSettings {
  id: 1;
  monthly_budget: number;
  updated_at: string;
}
```

---

## Matching Algorithm

```
MATCH_WINDOW = 48 hours  (transaction_at ± 48h vs receipt invoice_date)

for each unmatched transaction T:
  candidates = receipts where:
    - total_amount = T.amount
    - invoice_date within T.transaction_at ± 48h
    - not already matched to another transaction

  if candidates.count == 1:
    → auto-match: set T.matched_receipt_id = candidates[0].id, is_matched = true
    → PATCH Discord message (if discord_message_id set) with receipt items + auto-tags

  if candidates.count > 1:
    → create pending_match record
    → send Discord message listing candidates
    → await user button click to confirm

  if candidates.count == 0:
    → remain unmatched (retry on next sync)
```
