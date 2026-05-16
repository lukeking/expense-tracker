-- 008_add_source_to_transactions.sql
-- Adds a source column to transactions to track record origin.
-- Legacy migrated records are tagged with 'legacy_migration'.

ALTER TABLE transactions
  ADD COLUMN source TEXT;

CREATE INDEX idx_transactions_source ON transactions (source)
  WHERE source IS NOT NULL;
