# Quickstart — Invoice Import v2

Manual verification of the enrichment-only import. Assumes the backend runs locally
against Supabase and the PWA dev server is up.

## Prerequisites

- Apply migration `020_invoice_match_confidence.sql` to the Supabase database.
- Have a few **pre-existing** expense transactions (import only enriches; it never
  creates). A handy set:
  - One expense same-day & same amount as an invoice (→ `exact`).
  - One expense 2 days off & same amount (→ `near`).
  - Two expenses same amount & date as one invoice (→ `ambiguous`, exact source).
  - One expense ~3% off a foreign-currency invoice amount (→ `ambiguous`, forex source).
- A government e-invoice CSV (`test-invoices.csv` in the repo root works as a base).

## Run

```bash
# backend
cd backend && pnpm dev          # wrangler dev
# frontend (separate shell)
cd pwa && pnpm dev
```

## Walkthrough

1. **Import.** Open the PWA → Import screen → choose the CSV → 上傳並處理.
   - Summary shows `matched_exact`, `matched_near`, `ambiguous`, `skipped_unmatched`,
     `skipped_duplicate`, `skipped_voided`, `skipped_zero`.
   - Each matched row lists seller, confidence (同日/鄰近), and items outcome
     (已填入/保留).
2. **No transactions created (SC-003).** Note the transaction count before import;
   confirm it is unchanged after. Verify in DB:
   `SELECT count(*) FROM transactions;` before vs after.
3. **Auto-link correctness.** The same-day exact case is `exact`; the 2-day case is
   `near`; both transactions now carry `invoice_number` / `seller_name` and (if they
   had no items) invoice line items.
4. **Resolve ambiguous.** With `ambiguous > 0`, the screen lists each ambiguous
   invoice with its candidate transactions (incl. the forex case). For one:
   - Pick a candidate, leave "取代品項" off → 確認. Invoice becomes matched; if the tx
     had items they are kept, else filled. Card disappears; summary updates.
   - For another, toggle "取代品項" on → 確認. Existing items are replaced with the
     invoice's positive line items (outcome `replaced`).
5. **Re-import same file (SC-002).** Upload the same CSV again.
   - `matched` and `ambiguous` invoices are skipped as `skipped_duplicate`.
   - The previously `skipped_unmatched` invoice is re-attempted (and will match if you
     have since added a matching transaction).
   - Completes in < 3 s.

## Discord

`/import` and `/reconcile` no longer exist. After deploying, re-run
`pnpm tsx scripts/register-commands.ts` so Discord drops the two commands.

## Acceptance checks

- SC-003: transaction count identical before/after any import or resolve.
- SC-004: the seven summary buckets sum to the parsed-invoice total.
- FR-009: a transaction that already had items keeps them unless replace is chosen.
- Forex invoice is reachable only via the ambiguous list (never auto-linked).
