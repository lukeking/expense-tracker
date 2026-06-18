# UI Contract: Summary Drilldown Subcategory Filter

This app exposes no new endpoint or query parameter. The one backend change is additive to an existing response: `GET /pwa/transactions` now includes `effective_amount` on each item (`transaction_items(id, name, amount, effective_amount, tags)`). The feature's external contract is the **drilldown interaction** — the states, transitions, the membership predicate, and the net-amount rule that an E2E test (and a human) can verify.

## Interaction states

| State | `drilldown` | `subDrilldown` | What the user sees |
|-------|-------------|----------------|--------------------|
| **S0** Pie | `null` | `null` | Pie chart of majors + legend; full transaction history below. |
| **S1** Major drilldown | `Major` | `null` | Back button + `Major` + major total; subcategory **bar chart**; tx list filtered to `Major`. |
| **S2** Subcategory selected | `Major` | `Sub` | Breadcrumb `Major › Sub` + **net Sub total** + **clear control**; non-selected bars get the 百葉窗 shade (the `Sub` bar shows through); tx list filtered to `Sub`, **day-grouped**, day subtotals = net Sub spend. |

## Transitions

| From | Event | To | Effect |
|------|-------|----|--------|
| S0 | tap pie slice / legend row `Major` | S1 | set `drilldown=Major`, `subDrilldown=null` |
| S1 | tap subcategory bar `Sub` | S2 | set `subDrilldown=Sub` |
| S2 | tap a **different** bar `Sub2` | S2 | set `subDrilldown=Sub2` (replace, not stack) — FR-003 |
| S2 | tap the **active** bar `Sub` again | S1 | set `subDrilldown=null` (toggle clear) — FR-006(a) |
| S2 | tap the **clear control** | S1 | set `subDrilldown=null` — FR-006(b) |
| S1/S2 | tap **back** | S0 | set `drilldown=null`, `subDrilldown=null` |
| S1/S2 | change time base / navigate period / pick period | S0\* | reset `drilldown=null`, `subDrilldown=null` (existing behavior + new field) — FR-007 |

\* These already reset `drilldown` today; this feature adds `subDrilldown` to the same resets.

## Filter + amount contract (the assertion target)

While in **S2**, the transaction list MUST equal:

```
majorList.filter(tx => txInSubcategory(tx, Major, Sub))         // grouped by day
```

where `majorList` is the list shown in **S1** and `txInSubcategory` is:

```
tags = [...tx.tags, ...tx.items.flatMap(i => i.tags)]
Sub === '其他' : tags.some(t => t === Major)
else           : tags.some(t => t === `${Major}:${Sub}` || t.startsWith(`${Major}:${Sub}:`))
```

and amounts MUST be the **net per-item sum** (refunds negate):

```
subAmount(tx) = sign(tx) * Σ over matching items of (item.effective_amount ?? item.amount ?? 0)
row amount    = subAmount(tx)                  // the figure shown on each transaction row
day subtotal  = Σ subAmount over that day's S2 rows
header total  = Σ subAmount over the S2 list
```

Guarantees:
- **Subset**: the S2 list is always a subset of the S1 list (no row appears that wasn't already in the major list).
- **Exhaustive switch/clear**: leaving S2 (clear or re-tap) restores exactly the S1 list.
- **Net amounts reconcile bottom-up**: item lines → row (`subAmount(tx)`) → day subtotal → header total are all net subcategory amounts and sum consistently; they equal the subcategory's bar for item-tagged spend. Transaction-level-only tags are the documented edge (research D3).

## Composition with existing filters

The subcategory filter applies **on top of** the active tag filter, payment-method filter, and the selected period/time base (all already baked into `majorList`). Selecting a subcategory never clears those; clearing the subcategory never clears those (FR-004).

## i18n contract

Any new visible string (e.g. the clear control label / its `aria-label`) MUST have a key present in **both** `pwa/src/i18n/zh.ts` and `pwa/src/i18n/en.ts`; `tsc` fails the build on a missing `en` key and `pnpm i18n:check` guards against residual hardcoded CJK. The breadcrumb separator (`›`) is punctuation, not a translated string.
