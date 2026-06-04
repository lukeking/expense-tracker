-- 020_invoice_match_confidence.sql
-- Invoice Import v2: store match confidence on invoices; add v2 run counters.
-- The invoices.match_status CHECK constraint is intentionally left unchanged —
-- v2 stops PRODUCING auto_created / held_forex / parse_failed rows but the
-- constraint already permits the values we still use ('matched', 'ambiguous').

ALTER TABLE invoices
  ADD COLUMN match_confidence TEXT
    CHECK (match_confidence IN ('exact', 'near'));

ALTER TABLE import_runs
  ADD COLUMN matched_exact_count     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN matched_near_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN skipped_unmatched_count INTEGER NOT NULL DEFAULT 0;
