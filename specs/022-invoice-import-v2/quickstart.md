# Quickstart — Invoice Import v2

Manual verification (T022) of the enrichment-only import **and** the correction
tooling layered on top (un-match, unmatched detail, manual link). Assumes the backend
runs locally against Supabase and the PWA dev server is up.

The automated suite is logic-level (pure functions / a fake Supabase); this is the only
pass that exercises the real DB + handlers + PWA, so run it after schema/code changes.

## Prerequisites

- Apply migrations **`020_invoice_match_confidence.sql`** and
  **`021_transaction_item_provenance.sql`** to the Supabase database.
- Import only *enriches* — it never creates transactions. Have pre-existing expense
  transactions covering each case:
  - One same-day & same amount as an invoice (→ `exact`).
  - One 2 days off & same amount (→ `near`).
  - One that already has its own item(s) (to check items are `kept`, FR-009).
  - One with **no** items (to check items get `filled`).
  - Two same amount & date as one invoice (→ `ambiguous`, exact source).
  - One ~3% off a foreign-currency invoice amount (→ `ambiguous`, forex source).
  - One whose correct invoice differs in amount **beyond** the bands — e.g. an
    off-invoice discount (invoice 40 / paid 35) or a partial/pre-paid invoice
    (invoice 115 spanning two items, only one paid). These exercise **manual link**.
  - One whose only identity is a **tag** (no note, no items) — to confirm the picker
    surfaces tags.
- A government e-invoice CSV (`test-invoices.csv` in the repo root is a base).

## Run

```bash
cd backend && pnpm dev          # wrangler dev
cd pwa && pnpm dev              # separate shell
```

## Walkthrough

### A. Auto-match & summary (US1)

1. **Import.** Import screen → choose the CSV → 上傳並處理.
   - Summary shows the seven buckets: `matched_exact`, `matched_near`, `ambiguous`,
     `skipped_unmatched`, `skipped_duplicate`, `skipped_voided`, `skipped_zero`.
   - 已配對 rows list seller, confidence (同日/鄰近), items outcome (已填入/保留).
   - **略過·未配對** lists each unmatched invoice's seller / number / amount / date.
2. **SC-003 (no transactions created).** `SELECT count(*) FROM transactions;` before vs
   after import → identical.
3. **Auto-link correctness.** Same-day exact-amount = `exact`; 2-day = `near`. A tx that
   had no items gets the invoice items (`filled`); a tx with items keeps them (`kept`,
   FR-009). Both carry `invoice_number` / `seller_name`.

### B. Resolve ambiguous (US2)

4. With `ambiguous > 0`, each card lists candidate transactions (incl. the forex case,
   tagged 外幣近似) showing amount, date, **tags**, note, items.
   - Pick one, leave **取代品項** off → 確認連結. Items `kept` if the tx had some, else
     `filled`. Card disappears; counts update.
   - For another, toggle **取代品項** on → 確認. Existing items are `replaced` with the
     invoice's positive line items.

### C. Correction tooling

5. **Manual link from an unmatched invoice.** On a 略過·未配對 row tap **手動連結**:
   - The picker lists unlinked expenses within ±7 days with amount, date, **tags**, note,
     items; the filter matches note/tags/items.
   - Pick one whose amount differs (e.g. invoice 40 ↔ tx 35): the **金額不符** note shows
     and the link is still allowed.
   - Leave items unchecked → 確認連結. The invoice moves to 已配對, the tx gains
     `invoice_number` / `seller_name`, no items added.
6. **Manual link from an ambiguous card.** On a card whose candidates are all wrong, tap
   **都不對？手動連結到其他交易** → same picker → pick the correct tx → 確認連結. The
   invoice flips `ambiguous → matched` and leaves 待手動確認.
7. **Per-item append + dup-guard.** In the picker's item list: an invoice item whose name
   already exists on the chosen tx is **disabled** (交易已有同名品項); checking a fresh
   item appends it (default all unchecked). After confirming, the tx's `effective_amount`
   stays consistent — its summary total is unchanged.
8. **Un-link (解除).** In **已配對發票（可解除）** tap **解除** on a linked invoice:
   - The tx loses `invoice_number` / `seller_name` / `seller_tax_id` / `matched_invoice_id`.
   - **Only items this invoice created** are removed; a same-named *user* item survives
     (provenance). Effective amounts recomputed. The invoice row is deleted.
9. **Cumulative backlog.** Re-enter the Import screen (before uploading): 待手動確認 and
   已配對發票 show **all** unresolved ambiguous + **all** matched invoices (every run),
   not just the last import.

### D. Re-import & dedup (SC-002)

10. Re-import the same CSV:
    - `matched` and `ambiguous` invoices skip as `skipped_duplicate`; an invoice corrected
      via manual link (now `matched`) is also a duplicate.
    - A previously `skipped_unmatched` invoice is re-attempted (and matches if a tx now fits).
    - **Re-collision gone:** once a tx is correctly linked, no other same-amount invoice
      can steal it (it's no longer in the unlinked pool).
    - Completes in < 3 s.

## Discord

`/import` and `/reconcile` no longer exist. After deploying, re-run
`pnpm tsx scripts/register-commands.ts` so Discord drops the two commands.

## Acceptance checks

- **SC-003** — transaction count identical before/after any import, **manual link**, or
  **un-link** (these new endpoints never create or delete a transaction).
- **SC-004** — the seven summary buckets sum to the parsed-invoice total.
- **FR-007** — `skipped_unmatched` invoices are not persisted (re-surface on re-import);
  manual-linking one persists it at link time.
- **FR-009** — a tx that already had items keeps them unless replace is chosen.
- **Forex** — a forex invoice is reachable only via the ambiguous list (never auto-linked).
- **Provenance** — un-link removes only invoice-created items; same-named user items survive.
- **Manual link** — amount-agnostic (warns, never blocks); appends only checked items;
  items default unchecked; works from both unmatched rows and ambiguous cards.
