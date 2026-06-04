# Phase 1 Data Model — Invoice Import v2

Only a small schema delta is required; the v1 invoice/import tables (migration 004)
remain. See `contracts/schema-ddl.sql` for the exact migration.

## Schema delta (migration 020)

### `invoices` — add `match_confidence`

| Column | Type | Notes |
|---|---|---|
| `match_confidence` | `TEXT` NULL, `CHECK (… IN ('exact','near'))` | Set only when `match_status = 'matched'`. `exact` = matched tx is same calendar day as invoice; `near` = within ±2 days but not same day. NULL for `ambiguous` / skipped rows. |

`match_status` CHECK constraint is **unchanged**. v2 produces only `matched` and
`ambiguous` as persisted statuses (plus the historical skipped-* values are no longer
written as rows). No migration needed for the constraint.

### `import_runs` — add count columns

| Column | Type | Notes |
|---|---|---|
| `matched_exact_count` | `INTEGER NOT NULL DEFAULT 0` | Same-day auto-links + same-day manual resolves attributed to the run. |
| `matched_near_count` | `INTEGER NOT NULL DEFAULT 0` | ±2-day auto-links. |
| `skipped_unmatched_count` | `INTEGER NOT NULL DEFAULT 0` | Invoices with 0 candidates (not persisted as invoice rows). |

Existing v1 columns (`auto_created_count`, `held_forex_count`, `forex_resolved_count`,
`parse_failed_count`, `matched_count`) are retained for backward compatibility and
simply left at their defaults (0) by v2 — no destructive change.

## Entities

### Invoice (persisted: `matched` and `ambiguous` only)

Existing fields (migration 004): `id`, `import_run_id`, `invoice_number` (unique dedup
key), `seller_name`, `seller_tax_id`, `invoice_date`, `gross_amount`, `allowance`,
`net_amount` (generated `gross − allowance`), `items` (JSONB positive line items),
`invoice_status` (`active`/`voided`), `match_status`, `matched_transaction_id`,
`created_at`.

New: `match_confidence` (`exact`/`near`/NULL).

**Lifecycle in v2:**
```
parsed → dedup hit ─────────────────────────────► counted skipped_duplicate (no row)
       → voided / net 0 ─────────────────────────► counted skipped_voided/zero (no row)
       → 1 exact candidate ───────► matched (confidence exact|near), tx enriched
       → ≥2 exact candidates ─────► ambiguous ──(resolve)──► matched (replaced/kept/filled)
       → 0 exact, ≥1 forex ───────► ambiguous ──(resolve)──► matched
       → 0 exact, 0 forex ────────► counted skipped_unmatched (no row)
```

### Candidate Transaction (derived, not stored)

An existing `transaction` where `transaction_type='expense'`, `matched_invoice_id IS
NULL`, `transaction_at` within ±2 days of `invoice_date`, and amount matches:
- **exact candidate**: `amount = invoice.net_amount`
- **forex candidate**: `floor(net*0.95) ≤ amount ≤ ceil(net*1.05)` (only sourced when
  there are 0 exact candidates)

Surfaced to the client with `{ id, transaction_at, amount, note, items }`.

### Match Confidence

`exact` (same calendar day) | `near` (within ±2 days, not same day). Computed from the
matched transaction date vs invoice date at link time (import or resolve).

### Items Outcome (per matched invoice; not stored, returned in summary)

`filled` — transaction had 0 items, populated from invoice positive line items.
`kept` — transaction already had items, left unchanged.
`replaced` — user chose replace during manual resolution; existing items replaced with
invoice positive line items.

## Validation rules

- **Dedup (FR-001):** skip any parsed invoice whose `invoice_number` already exists in
  `invoices` before any matching.
- **Net amount (FR-002):** `Σ positive 發票金額 − |Σ negative 發票金額| − 折讓 allowance`
  (computed in `csv-parser.ts`, unchanged from v1).
- **No transaction creation (FR-005):** the pipeline and resolve endpoint never insert
  into `transactions`; verified by a before/after count invariant in tests (SC-003).
- **Auto-link only when exactly one exact candidate (FR-003):** forex candidates and
  ≥2-candidate sets never auto-link.
- **Candidate exclusion (FR-010):** `matched_invoice_id IS NULL` filter excludes
  already-linked transactions from both exact and forex candidate queries.
- **Resolve preconditions (FR-011):** invoice must be `ambiguous`; chosen transaction
  must exist and be unlinked.
