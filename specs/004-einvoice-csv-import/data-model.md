# Data Model: E-Invoice CSV Import + /amend

**Branch**: `004-einvoice-csv-import` | **Date**: 2026-05-09

---

## Schema Changes

### New columns on `transactions`

```sql
ALTER TABLE transactions
  ADD COLUMN invoice_number  TEXT,
  ADD COLUMN seller_name     TEXT,
  ADD COLUMN seller_tax_id   TEXT,
  ADD COLUMN matched_invoice_id UUID REFERENCES invoices(id);
```

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `invoice_number` | TEXT | YES | Denormalised from linked invoice for quick display |
| `seller_name` | TEXT | YES | Legal entity name from `賣方名稱`; may differ from brand |
| `seller_tax_id` | TEXT | YES | From `賣方統一編號`; stable for future brand-mapping |
| `matched_invoice_id` | UUID FK | YES | Links to `invoices.id` for both matched and auto-created cases |

`is_matched` (existing boolean column) remains the canonical "has invoice" flag.

---

### New table: `import_runs`

```sql
CREATE TABLE import_runs (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name              TEXT,
  total_rows             INTEGER     NOT NULL DEFAULT 0,
  matched_count          INTEGER     NOT NULL DEFAULT 0,
  auto_created_count     INTEGER     NOT NULL DEFAULT 0,
  skipped_duplicate_count INTEGER    NOT NULL DEFAULT 0,
  skipped_voided_count   INTEGER     NOT NULL DEFAULT 0,
  skipped_zero_count     INTEGER     NOT NULL DEFAULT 0,
  held_forex_count       INTEGER     NOT NULL DEFAULT 0,
  forex_resolved_count   INTEGER     NOT NULL DEFAULT 0,
  parse_failed_count     INTEGER     NOT NULL DEFAULT 0,
  uploaded_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

One record per `/import` invocation. The Discord summary message is derived from these counters.

---

### New table: `invoices`

```sql
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
                             'matched',
                             'auto_created',
                             'held_forex',
                             'skipped_duplicate',
                             'skipped_voided',
                             'skipped_zero',
                             'parse_failed'
                           )),
  matched_transaction_id UUID        REFERENCES transactions(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_invoice_number UNIQUE (invoice_number)
);

CREATE INDEX idx_invoices_invoice_date  ON invoices (invoice_date DESC);
CREATE INDEX idx_invoices_net_amount    ON invoices (net_amount);
CREATE INDEX idx_invoices_match_status  ON invoices (match_status)
  WHERE match_status = 'held_forex';
CREATE INDEX idx_invoices_import_run    ON invoices (import_run_id);
```

#### Key field notes

| Field | Notes |
|-------|-------|
| `invoice_number` | Government-issued; globally unique constraint enables cross-run dedup (FR-007) |
| `net_amount` | Computed: `gross_amount - allowance`. Used for all matching arithmetic |
| `invoice_status` | `voided` = 已作廢; these rows are created but immediately set to `skipped_voided` |
| `match_status` | State machine — see transitions below |
| `matched_transaction_id` | Set for `matched` and `auto_created` statuses; NULL for `held_forex` |
| `items` | JSONB array of `{name, quantity, unit_price, amount}` per line item |

#### `match_status` state transitions

```
parse_failed  ← row could not be parsed (stays terminal)
skipped_voided ← invoice_status = 'voided' (stays terminal)
skipped_zero   ← net_amount = 0 (stays terminal)
skipped_duplicate ← invoice_number already in invoices table (row not inserted)

pending → matched       ← primary exact match found (FR-003)
pending → held_forex    ← secondary ±5% match found (FR-011)
pending → auto_created  ← no match at all (FR-006)

held_forex → matched    ← reconciliation pass finds exact match after /amend (FR-012)
held_forex → auto_created ← reconciliation pass: no candidate at all anymore
```

---

## TypeScript Types

```typescript
// New types to add to types.ts

export type InvoiceMatchStatus =
  | 'pending'
  | 'matched'
  | 'auto_created'
  | 'held_forex'
  | 'skipped_duplicate'
  | 'skipped_voided'
  | 'skipped_zero'
  | 'parse_failed';

export interface InvoiceItem {
  name: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface Invoice {
  id: string;
  import_run_id: string;
  invoice_number: string;
  seller_name: string | null;
  seller_tax_id: string | null;
  invoice_date: string;        // ISO date string
  gross_amount: number;
  allowance: number;
  net_amount: number;          // computed
  items: InvoiceItem[] | null;
  invoice_status: 'active' | 'voided';
  match_status: InvoiceMatchStatus;
  matched_transaction_id: string | null;
  created_at: string;
}

export interface ImportRun {
  id: string;
  file_name: string | null;
  total_rows: number;
  matched_count: number;
  auto_created_count: number;
  skipped_duplicate_count: number;
  skipped_voided_count: number;
  skipped_zero_count: number;
  held_forex_count: number;
  forex_resolved_count: number;
  parse_failed_count: number;
  uploaded_at: string;
  created_at: string;
}

// Raw row from government CSV (before grouping by invoice_number)
export interface RawInvoiceRow {
  '載具自訂名稱': string;
  '發票日期': string;      // ROC format: "114/04/18"
  '發票號碼': string;
  '發票金額': string;
  '發票狀態': string;
  '折讓': string;
  '賣方統一編號': string;
  '賣方名稱': string;
  '賣方地址': string;
  '買方統編': string;
  '消費明細_數量': string;
  '消費明細_單價': string;
  '消費明細_金額': string;
  '消費明細_品名': string;
}

// Parsed and grouped invoice (ready for DB insert)
export interface ParsedInvoice {
  invoice_number: string;
  seller_name: string;
  seller_tax_id: string;
  invoice_date: Date;
  gross_amount: number;
  allowance: number;
  net_amount: number;
  invoice_status: 'active' | 'voided';
  items: InvoiceItem[];
}
```

---

## Migration file

Create: `backend/supabase/migrations/004_einvoice_import.sql`

```sql
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
```
