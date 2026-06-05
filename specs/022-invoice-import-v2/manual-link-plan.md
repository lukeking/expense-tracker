# Plan: Manual Link for Unmatched Invoices

Extends feature 022 (Invoice Import v2). Lets the user link a `skipped_unmatched`
invoice to an existing transaction they pick — **amount-agnostic** — so cases the
auto-matcher can't reach become linkable: legacy-flat amounts, off-invoice discounts
(eco-cup), and partial/pre-paid invoices (FamilyMart split).

## Settled decisions

1. **Defer D** (discount-aware matching) — future enhancement, not built here.
2. **Amount mismatch:** warn (`金額不符`), never block.
3. **Item handling:** per-item, **append-only**. List existing tx_items (read-only
   context) + invoice items each with a checkbox, **default unchecked**, **disable**
   any invoice item whose name already exists on the tx (dup guard). Create checked
   ones only. No replace/delete in this flow — fix wrong/placeholder items in the
   existing `EditExpenseSheet` editor instead.
4. **Provenance:** add `transaction_items.source_invoice_id` so create *and* un-link
   touch only link-created items (replaces the lossy name-based deletion).

## Core constraint — FR-007 (unmatched invoices not persisted)

- The import response carries the **full invoice payload** (incl. items +
  `import_run_id`) for each unmatched invoice; the client holds it.
- Manual-link **persists the invoice only at link time** (status → `matched`).
  Unlinked unmatched invoices stay unpersisted and still auto-retry on re-import.
- **Accepted limitation (v1):** manual link can only be *initiated from the current
  import result*. Navigate away → re-import the CSV (dedup makes that safe/cheap).

## Schema — migration `021_transaction_item_provenance.sql`

```sql
ALTER TABLE transaction_items
  ADD COLUMN source_invoice_id UUID;  -- NULL = user-entered; set = created by an invoice link
```
Plain nullable column (no FK) — it's a provenance tag; deletes are ordered in code.
**Backfill caveat:** items filled by imports *before* this migration have
`source_invoice_id = NULL`, so un-linking an old auto-match won't auto-remove its
filled items (remove via the edit screen). Applies cleanly to all new links.

## Backend

### `db/queries.ts`
- `insertTransactionItems` — accept optional `source_invoice_id` per item.
- `applyInvoiceItems(..., invoiceId)` — new param; stamp `source_invoice_id = invoiceId`
  on every item it inserts (auto-match `filled` + resolve `replaced` paths).
- New `deleteTransactionItemsBySourceInvoice(supabase, txId, invoiceId)` —
  `DELETE … WHERE transaction_id = txId AND source_invoice_id = invoiceId`.
- Remove `deleteTransactionItemsByName` (only the un-link path used it).
- Reuse `findTransactionsWithoutInvoiceInRange(from, to)` for the picker.

### Un-link (`POST /pwa/import/unlink`, already built) — update
- Swap name-based deletion → `deleteTransactionItemsBySourceInvoice(txId, invoiceId)`
  (delete items **before** deleting the invoice row).
- After deletion, **recompute** `computeAndWriteEffectiveAmounts(txId, tx.amount)`.

### Import response (`pwa.ts`, `invoice-matcher.ts`, `types.ts`) — extend
- Add `import_run_id` to the `POST /pwa/import` response.
- Enrich each `skipped_unmatched_detail` entry to the full persistable shape:
  `seller_tax_id`, `gross_amount`, `allowance`, `invoice_status`, `items[]`.

### `GET /pwa/import/link-candidates?date=<iso>&window=<days>`
- `findTransactionsWithoutInvoiceInRange` (default ±7 days of invoice date); returns
  `{id, amount, transaction_at, note, items[]}` per unlinked expense (items per-tx,
  like the ambiguous handler). Client does free-text note/item filtering.

### `POST /pwa/import/manual-link`
- Body: `{ invoice: <full payload>, import_run_id, transaction_id, item_indexes: number[] }`
  (`item_indexes` = checked invoice line items to append).
- Guards: tx exists, is expense, `matched_invoice_id == null` (else `409
  TRANSACTION_ALREADY_LINKED`); `invoice_number` not already persisted (else `409
  ALREADY_IMPORTED`).
- Ordered writes (mirror `resolve` for safe retry):
  1. `insertInvoice(..., status='pending')` → get invoice id.
  2. `enrichTransaction` (invoice_number / seller / seller_tax_id / matched_invoice_id).
  3. Append checked invoice items via `insertTransactionItems` with
     `source_invoice_id = invoice.id` (sort_order continues after existing items).
  4. `computeAndWriteEffectiveAmounts(txId, tx.amount)` — keep summaries consistent (Risk 1).
  5. `linkInvoiceToTransaction` (status `matched` + confidence + tx id) **last**.
- Confidence via `computeConfidence` → `near` whenever amounts differ.
- Returns the resolved `MatchedInvoiceDetail`.

## Frontend

### `ImportScreen.tsx`
- Each `略過·未配對` row → **手動連結** button, opens a `BottomSheet`.
- On link success: remove from the unmatched list, add to matched list, bump counts.

### `ManualLinkSheet.tsx` (new)
- Invoice header (seller / number / net / date) + its line items.
- Transaction picker: `GET link-candidates` (±7 days), radio list (amount, date, note,
  existing items) + free-text filter; `金額不符` note when picked tx amount ≠ invoice net.
- Item section: existing tx_items (read-only) + invoice items as checkboxes (default
  unchecked; checkbox disabled when the name already exists on the tx). A `金額不符`
  note when `Σ(existing items + checked invoice items) ≠ tx.amount`.
- `確認連結` → `POST manual-link` with the selected tx id + checked item indexes.

## Risks & resolutions

- **R1 effective-amount consistency** → recompute after manual-link append *and* after
  un-link deletion; warn on non-reconciling item sums.
- **R2 un-link data loss** → resolved by `source_invoice_id` (delete by provenance, not name).
- **R3 duplicate items** → default-unchecked + disable checkboxes for names already on the tx.
- **R4 zero items checked** → metadata-only link (invoice_number/seller); intended (eco-cup default).

## Verification

- Unit (logic-level, repo style): manual-link guards (`409` already-linked / already-imported),
  confidence = `near` on amount mismatch, item-index selection → only-checked appended,
  candidate windowing.
- E2E: link 六米禾 (40) → 格雷伯爵 (35), 0 items checked → metadata-only, summary unchanged;
  link FamilyMart 雙手卷 (55) line only → coffee not added; un-link → only provenance items
  removed, effective amounts recomputed; re-import → now `skipped_duplicate`.

## Out of scope

- **D** discount-aware matching (deferred).
- Replace/delete of existing items inside manual-link (use `EditExpenseSheet`).

## Deferred enhancements

- **Discount-aware matching (D)** — match invoice net against a transaction's gross
  (`amount` + recorded discount adjustments) so a properly-recorded discounted expense
  auto-links. Only helps future entries that record the discount; doesn't fix legacy-flat
  rows. See the earlier conversation; not built.
- **Per-item replace toggle in manual-link ("用發票品項取代")** — let a *checked* invoice
  item replace a *chosen existing* item, rather than only appending. Motivating case:
  legacy-imported transactions carry placeholder items (e.g. `早餐` / tag `食:早餐`) that
  the user wants overwritten with the invoice's real product name. Append-only can't do
  this, and the resolve flow's blunt "取代品項" (replace ALL) would wrongly pull in sibling
  invoice lines (e.g. a pre-paid item). Workaround today: link with nothing checked, then
  rename the placeholder in `EditExpenseSheet`. Worth building only if invoice-driven
  cleanup of legacy items becomes frequent — it adds a second item-editor surface.

- **"Mark as read" on linked cards (已配對發票 review-queue)** — solves the unbounded-growth
  + N+1 cost of loading *every* matched invoice on screen entry. Add a per-card 已讀 action
  (and a 全部標為已讀 bulk action) that hides a matched invoice from 已配對發票 once the user
  has verified the match. The list becomes a review queue of *unacknowledged* matches, not a
  full history — so it stays small and the N+1 transaction fetch is over a handful of rows.
  Ambiguous cards are NOT dismissible — they persist in 待手動確認 until finally linked.
  Sketch: `invoices.reviewed_at timestamptz NULL` (migration 022); `findAllMatchedInvoices`
  filters `reviewed_at IS NULL`; `POST /pwa/import/mark-read` (single + bulk by id list); UI
  buttons on `ImportScreen`'s 已配對發票 section. (Until then, an interim cheap win is batching
  the `GET /import/matched` transaction fetch into one `.in('id', […])` query.)
