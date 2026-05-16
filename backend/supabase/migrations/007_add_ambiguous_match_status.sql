-- Add 'ambiguous' to the invoices match_status check constraint.
-- The code has supported this status since migration 005 but the constraint was never updated.
ALTER TABLE invoices
  DROP CONSTRAINT invoices_match_status_check;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_match_status_check CHECK (match_status IN (
    'matched', 'auto_created', 'held_forex', 'ambiguous',
    'skipped_duplicate', 'skipped_voided', 'skipped_zero', 'parse_failed'
  ));
