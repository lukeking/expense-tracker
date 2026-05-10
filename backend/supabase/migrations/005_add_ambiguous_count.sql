ALTER TABLE import_runs
  ADD COLUMN IF NOT EXISTS ambiguous_count integer NOT NULL DEFAULT 0;
