# Phase 1 — Data Model

Feature: Discount-aware net spend for itemized transactions (025)

**No DDL / no migration.** Every column used already exists. This documents the fields the feature reads/writes and the invariant it enforces.

## Touched tables & columns

### `transaction_items`
| Column | Type | Role in this feature |
|---|---|---|
| `amount` | int, nullable | Item **face** value (gross). Unchanged. |
| `effective_amount` | int, nullable | Item **net** value = its share of the transaction's paid amount. **Now populated on invoice fill** (today: only on manual entry/edit). The value summaries read. |
| `source_invoice_id` | uuid, nullable | Provenance. Used by the US3 backfill to find invoice-filled items. Unchanged. |
| `tags` | text[] | Category tag (`cat:sub`) / plain tag. Unchanged. |

### `transactions`
| Column | Type | Role |
|---|---|---|
| `amount` | int | The **paid (net)** amount; the apportionment target for `effective_amount`. Read-only here. |

No other tables change.

## Core invariant (the fix)

For any transaction `T` with itemized amounts:

```
Σ over items i of effective_amount(i)  ==  T.amount        (the paid total)
```

and each item's net share is proportional to its face value:

```
effective_amount(i) = floor( amount(i) × T.amount / Σ amount )   for all but the largest item
largest item        = T.amount − Σ(other shares)                  (absorbs the rounding remainder)
```

Consequences:
- **Discounted** tx (Σ face > paid): each `effective_amount < amount`; summaries (which read `effective_amount ?? amount`) count net.
- **Non-discounted** tx (Σ face == paid): `effective_amount == amount`; no change.
- Items with `amount == null` are excluded from apportionment; their category contribution comes from the aggregators' existing remainder/`其他` fallback, unchanged.

## Derived/aggregation behaviour

- `aggregateByCategory` / `aggregateBySubcategory` already compute `item.effective_amount ?? item.amount`. With `getTransactionsForPeriod` now selecting `effective_amount`, the `??` resolves to the net value whenever present.
- **SC-002** (Σ category totals ≤ grand total) follows: per-tx item contributions sum to `amount`, and `grand_total` is `Σ amount`.

## State / lifecycle of `effective_amount`

| Event | Today | After this feature |
|---|---|---|
| Manual itemized create/edit | computed (proportional to paid) | unchanged |
| Invoice **auto-import** fill | NULL | computed in memory, bulk-written |
| Invoice **resolve** (confirm ambiguous) fill | NULL | computed (per-tx writer) |
| Invoice **manual-link** append | computed | unchanged (verify) |
| Historical invoice-filled rows | NULL/gross | corrected once by backfill script |
