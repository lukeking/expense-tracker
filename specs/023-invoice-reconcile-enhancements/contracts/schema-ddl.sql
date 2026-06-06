-- 022_invoice_reviewed_at.sql
-- Invoice Reconciliation Enhancements (US1): acknowledged ("read") state for matched
-- invoices, so the linked-invoice review list shows only unacknowledged matches by
-- default. NULL = unacknowledged; set = acknowledged (revealed via the 顯示已讀 toggle).

ALTER TABLE invoices
  ADD COLUMN reviewed_at TIMESTAMPTZ;
