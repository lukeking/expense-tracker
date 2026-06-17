# Phase 1 Data Model: Summary Subcategory Filter

No database, schema, or API changes. This feature adds **ephemeral view state** and one derived **membership rule** in `SummaryScreen.tsx`. The entities below describe in-memory shapes only.

## View State (component-local)

| Field | Type | Owner | Notes |
|-------|------|-------|-------|
| `drilldown` | `string \| null` | existing | The selected **major** category (pie slice). Unchanged. |
| `subDrilldown` | `string \| null` | **new** | The selected **subcategory** within `drilldown`. `null` = no subcategory filter (full major list). Only meaningful while `drilldown !== null`. |

**Invariants**:
- `subDrilldown` is always `null` when `drilldown` is `null` (cannot select a subcategory outside a drilldown).
- At most one subcategory is selected at a time (selecting another replaces it — FR-003).
- `subDrilldown` resets to `null` on: back to pie (`setDrilldown(null)`), selecting a different major, time-base change, period navigate, and period-picker select (FR-007) — i.e. everywhere `drilldown` is already reset today, plus the back action.

## Derived data (no new fetch)

| Name | Source | Use |
|------|--------|-----|
| Bar data | `subData.subcategories[]` (`{ subcategory, total, percentage }`) from existing `useSubcategoryData` | Renders the bars; also the **authoritative total** for the selected subcategory's header (D3). |
| Major tx list | `txData.transactions[]` from existing `useTransactions(..., drilldown, ...)` | The rows to filter in memory. |
| Filtered tx list | `txData.transactions.filter(tx => subDrilldown == null \|\| txInSubcategory(tx, drilldown, subDrilldown))` | Drives `groupTransactions(...)` and the history list. |

## Membership rule (the testable core)

`txInSubcategory(tx, major, sub)` → boolean. Operates on rows already known to belong to `major`.

```
tags  = [...tx.tags, ...tx.items.flatMap(i => i.tags)]
sub === '其他'  →  tags.some(t => t === major)
otherwise       →  tags.some(t => t === `${major}:${sub}` || t.startsWith(`${major}:${sub}:`))
```

- **Inputs**: a `TxRecord` (see `hooks/useSummary.ts`), the active `major` (`drilldown`), the active `sub` (`subDrilldown`).
- **Output**: include the transaction in the filtered list iff `true`.
- **`其他` bucket**: bare-major-tagged rows (no specific subcategory) — matches how `aggregateBySubcategory` buckets `其他`.
- **Pure function**: no I/O; deterministic given inputs — suitable as the unit of the e2e assertion and any future unit test.

## Presentation state (derived, no storage)

| Derived value | Rule |
|---------------|------|
| Active bar | the bar whose `subcategory === subDrilldown` gets the accent `<Cell>` fill; others normal/dimmed. |
| Header mode | `subDrilldown == null` → `Major` + major total; else → breadcrumb `Major › Sub` + that subcategory's total (from bar data). |
| Clear control visible | iff `subDrilldown != null`. |
