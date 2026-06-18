# Phase 1 Data Model: Summary Subcategory Filter

No database or schema changes, and no new endpoint or query parameter. The **one** payload change: `GET /pwa/transactions` adds the existing `effective_amount` column to its `transaction_items(...)` projection, and the PWA's `TxItem` type gains `effective_amount: number | null`. Everything else below is **ephemeral view state** + derived rules in `SummaryScreen.tsx`.

## View State (component-local)

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `drilldown` | `string \| null` | existing | The selected **major** category (pie slice). Unchanged. |
| `subDrilldown` | `string \| null` | **new** | The selected **subcategory** within `drilldown`. `null` = no subcategory filter (full major list). Only meaningful while `drilldown !== null`. |

**Invariants**:
- `subDrilldown` is always `null` when `drilldown` is `null` (cannot select a subcategory outside a drilldown).
- At most one subcategory is selected at a time (selecting another replaces it — FR-003).
- `subDrilldown` resets to `null` on: back to pie (`setDrilldown(null)`), selecting a different major, time-base change, period navigate, and period-picker select (FR-007) — i.e. everywhere `drilldown` is already reset today, plus the back action.

## Payload shape change

`TxItem` (PWA, `hooks/useSummary.ts`) gains `effective_amount`:

```
TxItem = { id, name, amount: number | null, effective_amount: number | null, tags: string[] }
```

`effective_amount` is the stored per-item net (discounts/adjustments already applied). Falls back to `amount` when null, mirroring the backend (`item.effective_amount ?? item.amount`).

## Derived data (no new fetch)

| Name | Source | Use |
|------|--------|-----|
| Bar data | `subData.subcategories[]` (`{ subcategory, total, percentage }`) from existing `useSubcategoryData` | Renders the bars (reference total for the selected subcategory). |
| Major tx list | `txData.transactions[]` from existing `useTransactions(..., drilldown, ...)` | The rows to filter + sum in memory. |
| Filtered tx list | `txData.transactions.filter(tx => subDrilldown == null \|\| txInSubcategory(tx, drilldown, subDrilldown))` | Day-grouped via `groupTransactions(...)` → the history list (Goal 1). |
| Subcategory period total | `sum over filtered txs of subAmount(tx, drilldown, subDrilldown)` | The header headline figure (Goal 2). |
| Day subtotal | `sum over the day's filtered txs of subAmount(...)` | Each day group's subtotal. |

## Net-amount rule (the amount each tx contributes to the subcategory)

`subAmount(tx, major, sub)` → number. A **faithful port of the backend `aggregateBySubcategory` per-transaction logic** so the client figures reconcile with the bar chart. This MUST mirror the backend because the app tags at the **transaction level** and items **inherit** that category (feature 027 B2) — most items carry no `major:` tag of their own, so a naive "sum items whose own tag matches" reads 0 for the common case.

```
sign       = tx.transaction_type === 'refund' ? -1 : 1
matchedSum = Σ effective_amount over items with an own `major:` tag
contrib    = Σ effective_amount over those whose sub === sub
remainder  = tx.amount − matchedSum                         // inherited / untagged / itemless spend
  if a `major:` tag exists on the tx (else any item):       // fallback
      add remainder to that tag's sub
  else if any `major`-prefixed tag exists:                  // bare-major / anyMatch
      add remainder to the 其他 bucket
return sign * contrib
```

- **`其他` bucket**: trailing `major:` (empty sub), bare-major fallback, or (drilling into the `其他` major) plain-tag items. Consistent with `aggregateBySubcategory`.
- **Net**: matched items use `effective_amount` (discounts already folded out); the remainder uses `tx.amount` (the paid amount, into which `effective_amount`s sum), so the figure is net.

## Membership rule (the list)

`txInSubcategory(tx, major, sub)` → `subAmount(tx, major, sub) !== 0`. A row appears in the subcategory's day-grouped list iff it has a non-zero net contribution — keeping the list and the amounts consistent (no NT$0 rows).

`itemInSubcategory(item, tx, major, sub)` → boolean, used to pick which **item lines** to show under the filter: the item's own `major:` tag if it has one, otherwise the category **inherited** from the tx (`itemSubcategory`).

- **Pure functions**: no I/O; deterministic — suitable as the unit of the e2e assertion and any future unit test.
- **Residual**: the displayed item-line breakdown (own-or-inherited per item) can differ slightly from the row total in rare mixed-tag transactions; the row total (`subAmount`) is authoritative and matches the bar.

## Presentation state (derived, no storage)

| Derived value | Rule |
|---------------|------|
| Active bar | the bar whose `subcategory === subDrilldown` shows through; the non-selected bars get the 百葉窗 semi-transparent shade overlay. |
| Header mode | `subDrilldown == null` → `Major` + major total; else → breadcrumb `Major › Sub` + the net subcategory period total. |
| Clear control visible | iff `subDrilldown != null`. |
