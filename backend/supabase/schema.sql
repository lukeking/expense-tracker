-- Expense Tracker: Supabase Schema Migration

CREATE TABLE IF NOT EXISTS receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  TEXT NOT NULL,
  random_code     TEXT NOT NULL,
  seller_name     TEXT NOT NULL,
  seller_tax_id   TEXT NOT NULL,
  total_amount    INTEGER NOT NULL,
  items           JSONB NOT NULL,
  invoice_date    DATE NOT NULL,
  carrier_type    TEXT NOT NULL DEFAULT 'mobile_barcode',
  raw_data        JSONB NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_receipt UNIQUE (invoice_number, invoice_date, seller_tax_id, random_code)
);

CREATE INDEX IF NOT EXISTS idx_receipts_invoice_date ON receipts (invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_receipts_total_amount ON receipts (total_amount);

CREATE TABLE IF NOT EXISTS transactions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type      TEXT NOT NULL DEFAULT 'expense' CHECK (transaction_type IN ('expense', 'refund', 'fee')),
  amount                INTEGER NOT NULL CHECK (amount > 0),
  items              JSONB,
  tags               TEXT[] DEFAULT '{}',
  payment_method     TEXT NOT NULL CHECK (
                       payment_method IN ('credit_card', 'prepaid_wallet', 'easy_card', 'bank_account', 'cash')
                     ),
  wallet             TEXT CHECK (
                       wallet IS NULL OR payment_method IN ('credit_card', 'prepaid_wallet')
                     ),
  bank_name          TEXT,
  note               TEXT,
  is_matched            BOOLEAN NOT NULL DEFAULT FALSE,
  matched_receipt_id    UUID REFERENCES receipts(id),
  parent_transaction_id UUID REFERENCES transactions(id),
  discord_message_id    TEXT,
  transaction_at     TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_transaction_at ON transactions (transaction_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_is_matched ON transactions (is_matched) WHERE is_matched = FALSE;

CREATE TABLE IF NOT EXISTS budget_settings (
  id             INTEGER PRIMARY KEY DEFAULT 1,
  monthly_budget INTEGER NOT NULL DEFAULT 20000,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO budget_settings (id, monthly_budget) VALUES (1, 20000)
  ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS pending_matches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id     UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  candidate_ids      UUID[] NOT NULL,
  discord_message_id TEXT,
  resolved           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
