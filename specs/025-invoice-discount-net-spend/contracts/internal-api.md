# Phase 1 — Internal Contracts

Feature: Discount-aware net spend for itemized transactions (025)

**HTTP/API contract: UNCHANGED.** `/pwa/summary`, `/pwa/summary/subcategories`, `/pwa/import`, `/pwa/import/resolve`, `/pwa/import/manual-link` keep identical request/response shapes. Only stored `effective_amount` values and summary numbers change. This file lists the internal (function-level) changes.

## Changed signatures / shapes

### `getTransactionsForPeriod` (queries.ts) — select +`effective_amount`
```ts
// Row select gains effective_amount on the related items:
//   'id, amount, transaction_type, payment_method, tags, transaction_at,
//    parent_transaction_id, transaction_items(amount, effective_amount, tags)'
// Return type TransactionForPeriod.transaction_items already declares
// effective_amount?: number | null — no type change needed.
```

### `bulkInsertTransactionItems` (queries.ts) — row gains `effective_amount`
```ts
bulkInsertTransactionItems(
  supabase,
  rows: {
    transaction_id: string; name: string; amount: number | null;
    effective_amount?: number | null;   // NEW (defaults to null when omitted → no behaviour change for other callers)
    tags: string[]; sort_order: number; source_invoice_id: string | null;
  }[]
): Promise<void>
```

## New (extracted) pure helper

### `computeEffectiveShares` (queries.ts) — single source of the proportional rule
```ts
// Pure: distributes `paidTotal` across items proportional to face `amount`,
// flooring each share and adding the remainder to the largest-amount item.
// Items with amount == null get no share (excluded). Items sum exactly to paidTotal.
export function computeEffectiveShares(
  items: { id: string; amount: number | null }[],
  paidTotal: number
): Map<string /*item id*/, number /*effective_amount*/>
```
- `computeAndWriteEffectiveAmounts` is refactored to: fetch items → `computeEffectiveShares` → write. Behaviour identical (regression-tested by existing callers).
- `runImportPipeline` uses the same helper on in-memory fill items (keyed by a transient index rather than id, since ids don't exist pre-insert) to set `effective_amount` on the bulk-insert rows.

> Note: for the pipeline the items have no DB id yet; the helper accepts a stable key (array index works) so it can serve both pre-insert (pipeline) and post-insert (DB writer) callers. Implementation may key by index and map back to rows.

## Behavioural contracts (test oracles)

| ID | Contract |
|---|---|
| C1 | `aggregateByCategory`/`Subcategory` use `effective_amount` when present; identical output when all items' `effective_amount == amount` or are null. |
| C2 | After `POST /import/resolve` fills a discounted invoice, the matched tx's items carry `effective_amount` summing to `tx.amount`. |
| C3 | After `runImportPipeline` auto-fills a discounted invoice, the filled items carry `effective_amount` summing to the matched tx's `amount`; non-discounted fills get `effective_amount == amount`. |
| C4 | `runImportPipeline` subrequest count is unchanged vs feature 024 (no per-match round-trip added). |
| C5 | `computeEffectiveShares`: proportional split; remainder to largest; Σ shares == paidTotal; null-amount items excluded. |
| C6 | Backfill script: corrects invoice-filled discounted txs; idempotent; leaves non-discounted and manual rows untouched. |
| C7 | `PUT /expense` edit keeps `effective_amount` reconciled to the edited `amount` (FR-008). |

## Backfill script contract

```
scripts/backfill-effective-amounts.ts [--dry-run] [--apply]
```
- Selects transactions with items where `source_invoice_id IS NOT NULL` and Σ(item.amount) ≠ transactions.amount.
- For each, recomputes `effective_amount` via the shared helper / per-tx writer.
- `--dry-run` (default): prints per-tx before→after; writes nothing.
- `--apply`: performs the writes. Idempotent (a second `--apply` is a no-op).
