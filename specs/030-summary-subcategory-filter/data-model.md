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

## Membership rule (the testable core)

`txInSubcategory(tx, major, sub)` → boolean. Operates on rows already known to belong to `major`.

```
tags  = [...tx.tags, ...tx.items.flatMap(i => i.tags)]
sub === '其他'  →  tags.some(t => t === major)
otherwise       →  tags.some(t => t === `${major}:${sub}` || t.startsWith(`${major}:${sub}:`))
```

## Net-amount rule (the amount each tx contributes to the subcategory)

`subAmount(tx, major, sub)` → number. Sums the **matching items'** net amount; refunds negate.

```
sign  = tx.transaction_type === 'refund' ? -1 : 1
items = tx.items.filter(i => itemInSubcategory(i, major, sub))   // same predicate, per item
net   = items.reduce((s, i) => s + (i.effective_amount ?? i.amount ?? 0), 0)
return sign * net
```

- **`其他` bucket**: items whose only `major`-tag is the bare major (no `Major:Sub`). Consistent with `aggregateBySubcategory`.
- **Pure functions**: no I/O; deterministic — suitable as the unit of the e2e assertion and any future unit test.
- **Known edge** (research D3): transactions tagged only at the tx level (no item carries the tag) contribute 0 here but are apportioned by the bar's remainder rule — minor, deliberately not reproduced.

## Presentation state (derived, no storage)

| Derived value | Rule |
|---------------|------|
| Active bar | the bar whose `subcategory === subDrilldown` shows through; the non-selected bars get the 百葉窗 semi-transparent shade overlay. |
| Header mode | `subDrilldown == null` → `Major` + major total; else → breadcrumb `Major › Sub` + the net subcategory period total. |
| Clear control visible | iff `subDrilldown != null`. |
