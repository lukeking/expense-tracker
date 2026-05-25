-- ─── 018: transaction_items.note ─────────────────────────────────────────────
-- Adds nullable per-item note column. No backfill. Idempotent via IF NOT EXISTS.

ALTER TABLE transaction_items
  ADD COLUMN IF NOT EXISTS note TEXT CHECK (char_length(note) <= 200);
