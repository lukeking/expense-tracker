-- 021_transaction_item_provenance.sql
-- Invoice Import v2 — manual link: track which transaction_items were created by an
-- invoice link, so create AND un-link touch only link-created items (replacing the
-- earlier name-based deletion, which could delete a user's own same-named item).
-- NULL = user-entered; set = created by linking the given invoice.

ALTER TABLE transaction_items
  ADD COLUMN source_invoice_id UUID;
