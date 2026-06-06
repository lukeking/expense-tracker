-- Cleanup: align the invoices.match_status column DEFAULT with its CHECK constraint.
--
-- Migration 004 set the column DEFAULT to 'pending', but 'pending' was never part of the
-- match_status CHECK constraint (defined in 004, redefined in 007). Any INSERT that relied
-- on the default therefore violated the constraint — the HTTP 500 seen on manual-link of an
-- unmatched invoice, patched in code (handlers/pwa.ts) by inserting 'ambiguous' explicitly.
--
-- Setting the default to a constraint-valid value makes the column self-consistent and
-- removes the latent foot-gun for any future INSERT path.
ALTER TABLE invoices
  ALTER COLUMN match_status SET DEFAULT 'ambiguous';
