-- ─── 019: transaction_edit_history ────────────────────────────────────────────
-- Append-only audit log of expense transaction edits.
-- Each row records one save event: timestamp + JSONB diff (before/after).
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS transaction_edit_history (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid        NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  edited_at      timestamptz NOT NULL DEFAULT now(),
  diff           jsonb       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edit_history_tx_time
  ON transaction_edit_history (transaction_id, edited_at);

GRANT SELECT, INSERT ON transaction_edit_history TO service_role;
