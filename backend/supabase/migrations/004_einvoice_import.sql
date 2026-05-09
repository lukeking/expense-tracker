-- 004_einvoice_import.sql

-- Import run audit log
CREATE TABLE import_runs (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name               TEXT,
  total_rows              INTEGER     NOT NULL DEFAULT 0,
  matched_count           INTEGER     NOT NULL DEFAULT 0,
  auto_created_count      INTEGER     NOT NULL DEFAULT 0,
  skipped_duplicate_count INTEGER     NOT NULL DEFAULT 0,
  skipped_voided_count    INTEGER     NOT NULL DEFAULT 0,
  skipped_zero_count      INTEGER     NOT NULL DEFAULT 0,
  held_forex_count        INTEGER     NOT NULL DEFAULT 0,
  forex_resolved_count    INTEGER     NOT NULL DEFAULT 0,
  parse_failed_count      INTEGER     NOT NULL DEFAULT 0,
  uploaded_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Parsed invoice records
CREATE TABLE invoices (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  import_run_id          UUID        NOT NULL REFERENCES import_runs(id),
  invoice_number         TEXT        NOT NULL,
  seller_name            TEXT,
  seller_tax_id          TEXT,
  invoice_date           DATE        NOT NULL,
  gross_amount           INTEGER     NOT NULL,
  allowance              INTEGER     NOT NULL DEFAULT 0,
  net_amount             INTEGER     GENERATED ALWAYS AS (gross_amount - allowance) STORED,
  items                  JSONB,
  invoice_status         TEXT        NOT NULL DEFAULT 'active'
                           CHECK (invoice_status IN ('active', 'voided')),
  match_status           TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (match_status IN (
                             'matched', 'auto_created', 'held_forex',
                             'skipped_duplicate', 'skipped_voided',
                             'skipped_zero', 'parse_failed'
                           )),
  matched_transaction_id UUID        REFERENCES transactions(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_invoice_number UNIQUE (invoice_number)
);

CREATE INDEX idx_invoices_invoice_date ON invoices (invoice_date DESC);
CREATE INDEX idx_invoices_net_amount   ON invoices (net_amount);
CREATE INDEX idx_invoices_held_forex   ON invoices (match_status)
  WHERE match_status = 'held_forex';
CREATE INDEX idx_invoices_import_run   ON invoices (import_run_id);

-- Extend transactions with invoice enrichment fields
ALTER TABLE transactions
  ADD COLUMN invoice_number     TEXT,
  ADD COLUMN seller_name        TEXT,
  ADD COLUMN seller_tax_id      TEXT,
  ADD COLUMN matched_invoice_id UUID REFERENCES invoices(id);
