-- Speed up get_category_totals / get_subcategory_totals RPCs.
-- (1) Narrow transactions by type+time before joining items.
CREATE INDEX IF NOT EXISTS idx_transactions_type_at
  ON transactions (transaction_type, transaction_at);

-- (2) Covering index so the items join can be satisfied without heap fetch.
CREATE INDEX IF NOT EXISTS idx_transaction_items_covering
  ON transaction_items (transaction_id) INCLUDE (amount, tags);
