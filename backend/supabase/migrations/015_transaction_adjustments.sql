-- Migration 015: transaction_adjustments table + effective_amount column
--
-- 1. Create transaction_adjustments table
CREATE TABLE IF NOT EXISTS transaction_adjustments (
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

CREATE INDEX IF NOT EXISTS idx_transaction_adjustments_transaction_id
  ON transaction_adjustments (transaction_id);

-- 2. Add effective_amount column to transaction_items
ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS effective_amount INTEGER NULL;

-- 3. Backfill: existing items with a non-null amount get effective_amount = amount (no-adjustment baseline)
UPDATE transaction_items
SET effective_amount = amount
WHERE effective_amount IS NULL AND amount IS NOT NULL;
