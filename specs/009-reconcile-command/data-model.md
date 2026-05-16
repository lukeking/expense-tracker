# Data Model: Standalone Invoice Reconciliation Command

**Branch**: `009-reconcile-command` | **Date**: 2026-05-10

## Schema Changes

**None.** The existing schema is sufficient for all requirements.

## Existing Entities Used

### `invoices` (existing table — read and updated)

| Field | Type | Relevance |
|---|---|---|
| `id` | UUID | Primary key; used in button custom_ids |
| `invoice_number` | TEXT | Dedup key; shown in held list |
| `seller_name` | TEXT | Shown in held list and sequential prompt |
| `seller_tax_id` | TEXT | Written to transaction on link |
| `invoice_date` | DATE | Used for ±2-day matching window |
| `net_amount` | INTEGER | `gross_amount - allowance`; used for matching |
| `match_status` | ENUM | Queried (`held_forex`, `ambiguous`) and updated (`matched`, `auto_created`) |
| `matched_transaction_id` | UUID | NULL for held/ambiguous; set on resolution |

**Relevant match_status values for this feature:**
- `held_forex` — queried by existing `findAllHeldForexInvoices`; resolved by extended `runReconciliationPass`
- `ambiguous` — queried by new `findAllAmbiguousInvoices`; auto-linked if now 1 candidate; otherwise presented for user selection

### `transactions` (existing table — read and updated)

| Field | Type | Relevance |
|---|---|---|
| `id` | UUID | Used in button custom_ids and matching |
| `amount` | INTEGER | Matched against `invoices.net_amount` |
| `transaction_at` | TIMESTAMPTZ | Used for ±2-day date window |
| `transaction_type` | ENUM | Only `expense` rows are eligible |
| `matched_invoice_id` | UUID | NULL check guards against double-linking |
| `is_matched` | BOOLEAN | Set to `true` on successful link |
| `invoice_number` | TEXT | Written on link |
| `seller_name` | TEXT | Written on link |
| `seller_tax_id` | TEXT | Written on link |
| `items` | JSONB | Read for candidate label display in sequential prompt |
| `note` | TEXT | Read for candidate label display in sequential prompt |

## New DB Query Functions

### `findAllAmbiguousInvoices(supabase)`

```
SELECT * FROM invoices WHERE match_status = 'ambiguous'
ORDER BY invoice_date ASC
```

Returns all unresolved `ambiguous` invoices. Used by:
- The extended `runReconciliationPass` (re-evaluate for 1-candidate auto-link)
- The reconcile handler (build sequential prompt list for remaining ambiguous invoices)

### (Reuse) `resolveHeldInvoice(supabase, invoiceId, txId, 'matched')`

Already exists. Used unchanged to link an ambiguous invoice to the chosen transaction:
```
UPDATE invoices SET match_status = 'matched', matched_transaction_id = txId WHERE id = invoiceId
```

### (Reuse) `findMatchingExpenseTransaction(supabase, netAmount, invoiceDate)`

Already exists. Re-called at reconcile time for each `ambiguous` invoice to get the current candidate set (±2-day window, exact amount, `matched_invoice_id IS NULL`).

### (Reuse) `enrichTransaction(supabase, txId, { invoiceNumber, sellerName, sellerTaxId, invoiceId })`

Already exists. Called after linking to populate the transaction's invoice fields.

## Reconciliation Pass — Extended Logic

The updated `runReconciliationPass` executes two loops:

**Loop 1 (existing) — held_forex invoices:**
1. Exact-match check → auto-link if found
2. Forex ±5% check → leave held if still a candidate
3. No candidate → auto-create new expense record

**Loop 2 (new) — ambiguous invoices:**
1. Re-query `findMatchingExpenseTransaction` for current candidates
2. If exactly 1 candidate → auto-link (same as Loop 1 exact-match path)
3. If 0 candidates → auto-create new expense record
4. If 2+ candidates → leave held (user must select explicitly)

**Return value extension:**

```typescript
interface ReconciliationResult {
  forexResolved: number;       // existing
  ambiguousAutoResolved: number;  // new
  ambiguousRemaining: Invoice[];  // new — passed to handler for sequential prompt
}
```

## State Transitions

```
held_forex  ──exact match──────────────────► matched       (existing)
held_forex  ──no candidate─────────────────► auto_created  (existing)
held_forex  ──still ±5%────────────────────► held_forex    (no change)

ambiguous   ──exactly 1 candidate (pass)───► matched       (new — auto-link)
ambiguous   ──0 candidates (pass)──────────► auto_created  (new — auto-create)
ambiguous   ──2+ candidates (pass)─────────► ambiguous     (no change)
ambiguous   ──user selects candidate────────► matched       (new — explicit link)
ambiguous   ──user skips────────────────────► ambiguous     (no change)
```
