# Transaction Adjustments & Effective Amount — Design Notes

**Status**: Living design doc. Captures architectural decisions reached through discussion before they are formalised in a feature spec (anticipated: spec 016).

**Scope**: How discount, fee, refund, and point-credit-style modifiers attach to a transaction, and how per-item amounts flow through to summary aggregations without distortion.

---

## Problem origins (real-world use cases the existing schema doesn't handle cleanly)

1. **Order-level percentage discount** — e.g. online order, credit card pays whole order at 10% off. Today: enter items at MSRP + total at MSRP + a fake refund row for the discount amount. Semantically wrong (it's not a refund), pollutes refund-side analytics.
2. **Platform point credits** — e-commerce platforms give "coins" that reduce checkout total. Same fake-refund workaround as above.
3. **Single-item discount** — only certain items in an order are discounted (e.g. "drinks half price, food full price"). Less common; today no clean way.
4. **Summary drill-in distortion** — even with the fake refund workaround, drilling into "食" in the summary shows MSRP totals, not what was actually paid. Discount/refund happen at transaction level; categorisation happens at item level; the two never reconcile in the current model.

All four collapse into one missing concept: **a transaction-level monetary modifier separate from the items list**, with a clean rule for how it flows back into per-item amounts when the summary needs them.

---

## Core decision: discount joins the adjustments family

The fee/refund design already on the roadmap (future `transaction_adjustments` table) gains a third `kind`:

```text
transaction_adjustments.kind ∈ { 'fee', 'refund', 'discount' }
```

All three share the same shape — a monetary modifier hanging off a parent transaction. They differ only in:

| kind     | Sign vs paid total | Typical timing            |
|----------|-------------------|---------------------------|
| fee      | + (you paid more) | post-hoc (days later)     |
| refund   | − (money came back) | post-hoc                |
| discount | − (you paid less) | point-of-sale (same time) |

`transaction_at` on the adjustment captures the timing distinction; discount adjustments simply share the parent's timestamp.

### Adjustment shape (working sketch)

```text
transaction_adjustments
├── id
├── transaction_id              FK → transactions
├── kind                        'fee' | 'refund' | 'discount'
├── amount                      INT, always positive — sign is implied by kind
├── transaction_at              for fee/refund: own time; for discount: = parent.transaction_at
├── basis?                      'absolute' | 'percentage' | NULL (annotation only, not used in math)
├── basis_value?                INT — e.g. 10 for "10%", 50 for "NT$50 off"
├── note?
├── source                      'manual' | 'discord' | 'invoice_derived' | …
└── created_at, updated_at
```

**Important**: `basis` and `basis_value` are documentation-only. The math never reads them. The math always sums signed amounts:

```text
transaction.amount = SUM(items.amount) + SUM(fee.amount) − SUM(refund.amount) − SUM(discount.amount)
```

This makes the model platform-algorithm-agnostic — see "Schema is agnostic to platform discount rules" below.

---

## Summary drill-in fix: `item.effective_amount` + proportional allocation

Add one column to `transaction_items`:

```text
transaction_items
├── amount             INT — original price (MSRP/billed), preserved for receipt fidelity
└── effective_amount   INT — this item's allocated share of what was actually paid
```

**No adjustment present**: `effective_amount = amount`. Trivial.

**Adjustment present**: distribute `paid_total` across items proportionally to `amount`:

```text
paid_total          = transaction.amount  (definitionally: what was actually charged)
items_total         = SUM(items.amount)
effective_amount_i  = floor(item.amount_i × paid_total / items_total)
```

Floor will leave a small integer remainder. Convention: **dump the remainder onto the largest item** (or, if tied, the last by `sort_order`), so `SUM(effective_amount) == paid_total` exactly. No decimals ever surface to the UI.

### Summary aggregation changes

```text
category_total = SUM(item.effective_amount)  WHERE item.tag in category
```

Drill-in becomes truthful: "食 this month NT$1,247" reflects what was actually spent on food, not the gross of MSRPs across orders that had discounts.

### Worked examples

| Items (amount)       | items_total | paid_total | Allocation                      | Validation |
|----------------------|-------------|-----------:|---------------------------------|------------|
| [100, 100, 100, 100, 100] | 500     | 450        | [90, 90, 90, 90, 90]            | sum = 450 ✓ |
| [100, 100, 100]      | 300         | 250        | [83, 83, 84] (last absorbs +1)  | sum = 250 ✓ |
| [100, 200, 300]      | 600         | 540        | [90, 180, 270]                  | sum = 540 ✓ |
| [99, 1]              | 100         | 90         | [89, 1] (largest absorbs −1 from rounding-then-fix) | sum = 90 ✓ |

---

## Schema is agnostic to platform discount rules

Different e-commerce / POS / restaurant platforms stack discounts and points using their own rules (multiply-then-subtract vs subtract-then-multiply, rounding behaviours, point-conversion ratios, etc.). **The schema does not need to know any of this.**

Why: the user, at checkout, sees a final paid amount. That number is the input to the model. The user can additionally record individual adjustment lines (a 10% discount + a NT$50 coupon, separately) for human bookkeeping, but the math never re-derives the paid total from those lines — it trusts the user-entered final figure.

### UI implication

The form simply shows a running balance:

```text
Items:           500   (auto from items list)
− Discount 10%:  -50   (user input)
− Point credit:  -30   (user input)
+ Fee:             0
= Calculated:    420
  Actual paid:   420   (user enters; pre-fills with calculated)
```

If `Calculated == Actual paid`, the user knows their adjustment lines are arithmetically consistent. If not, they adjust the lines or override `Actual paid` (in which case the discrepancy is silently absorbed). Source of truth = `Actual paid`.

This sidesteps "user has to learn platform N's stacking rule" entirely. The user records what they observed (final total + the discounts the receipt mentioned); the app trusts the observation.

---

## Single-item discount: deliberate non-feature

**Decision**: do NOT add `adjustments.target_item_id`. Adjustments always apply whole-order; allocation is always proportional across all items.

When a discount really only applies to one item, the user has two pragmatic options (both acceptable):

### Option A (manual-entry shortcut, recommended for solo-input flows)

Record the discounted price directly as the item's `amount`, add a note explaining "this item was discounted from X to Y". Skip any adjustment row.

- Pros: zero schema impact, no allocation complexity, drill-in totals come out correct
- Cons: loses MSRP fidelity for that item; can't aggregate "total saved on per-item discounts" later

### Option B (when you want MSRP preserved)

Record the item at MSRP and add a whole-order discount adjustment for the per-item discount amount. The effective_amount allocator will still spread it proportionally across all items, which is technically wrong for the per-category drill-in but **the magnitude of distortion is small for typical orders** (you might see "drinks" undercounted by a few NT and "food" overcounted by a few NT; nothing financially meaningful).

### Conflict with invoice-fill flow (real but acceptable)

If the user enters items without amounts at point of sale (deferring item-level data to invoice import), the receipt from 載具 API arrives with MSRP prices. Conflict modes:

- **Order-level discount**: receipt total < items_sum on receipt. The matcher recognises this as a discount situation and creates a whole-order discount adjustment automatically. Clean.
- **Single-item discount, Option A entered manually**: user has already entered the discounted price; receipt shows MSRP. Item amounts disagree. The matcher will either flag this as an ambiguous match (existing spec-002 flow) or override the manual values (default behaviour TBD per spec 016).

For personal use, single-item discount via invoice-fill is rare enough that we accept it triggering the ambiguous-match flow. No special handling.

---

## Point credit: same as discount initially; enum split later if needed

**Decision**: point credit uses `kind = 'discount'` with a note like "蝦皮幣折抵". Don't add a `'point_credit'` enum value in v1.

Reasoning:
- The math is identical to a regular discount
- Whether they show up as separate UI flows is a product decision, not a schema requirement
- Note field gives full historical visibility for review
- Splitting the enum later (when there's concrete UI demand) is a non-breaking migration

**Caveat to the user's earlier framing**: the enum choice is *mostly* data-layer cleanliness, but it does slightly leak into UI. If the enum exists, the UI is naturally pushed toward offering "點數抵扣" as a distinct button alongside "折扣". Without the enum, both flow through a single "折扣" button and the user types "點數" into the note field. So: the enum decision is data-layer + a small UX hint, not purely data-layer.

---

## Audit (spec 015) interaction

The audit script that's currently being implemented under spec 015 will need a follow-up patch once the adjustments table lands:

- **FR-010 (items_sum_mismatch)** currently checks `SUM(items.amount) ≠ transactions.amount`. After 016, change to `SUM(items.effective_amount) ≠ transactions.amount` — much tighter, requires allocation result to byte-align with paid total.
- **New invariant check (post-016)**: `SUM(items.amount) + SUM(fee) − SUM(refund) − SUM(discount) ≠ transactions.amount` — catches inconsistencies between adjustments and paid total.
- **New pattern check (post-016)**: "refund row with `transaction_at` within ~5 min of parent AND amount is a round 5/10/15/20% of parent, or a common round NT$ amount" → flags pre-016 fake-refund-as-discount rows that need migration. Add this only after the spec 015 samplers reveal the historical volume.

Spec 015 itself is **not** modified by this design. The patches happen as part of spec 016.

---

## Migration plan (for spec 016, not 015)

In rough order:

1. Create `transaction_adjustments` table with `kind ∈ {fee, refund, discount}`.
2. Add `transaction_items.effective_amount INT`.
3. Backfill: every existing item gets `effective_amount = amount` (no-adjustment assumption).
4. Convert existing fee/refund standalone transaction rows → adjustments on their parent → delete original rows.
5. Heuristic-detect existing fake-refund-as-discount rows → convert to discount adjustments → re-allocate `effective_amount` on affected parents.
6. Rewrite summary RPC (spec 010's `010_summary_rpc.sql`) to aggregate `effective_amount` instead of `amount`.
7. Update PWA entry/edit screens to surface discount/fee/refund as first-class adjustment rows in the form, with running-balance preview.
8. Update PWA summary to display drill-in totals from `effective_amount`.

Each step is independently testable and can ship behind a flag if needed.

---

## Open questions (carry forward to spec 016 author)

- **Allocation when an item's `amount` is NULL**: treat as 0 in allocation? Or skip and don't assign an `effective_amount`? Lean: skip — preserves the "unknown" semantic.
- **Multiple adjustments stacked, application order**: arithmetically order doesn't matter (all summed). But for display/audit trail, recorded order is the natural choice.
- **Adjustment-only transactions (e.g. credit card cashback hitting the statement)**: do they go through this model at all? Lean: cashback is a *different* event entirely (it's effectively post-hoc income against an account, not a modifier of a specific transaction). Out of scope for the adjustments table.
- **Edit/recompute UX**: when a user edits an adjustment on an existing transaction, when does the `effective_amount` recomputation happen — sync on write, or in a trigger? Lean: app-layer sync on write, matches the "no DB-side magic" principle the audit-catalog discussion reached.
- **Invoice-fill conflict resolution policy**: if manually-entered items disagree with imported receipt, who wins? Lean: existing ambiguous-match flow (user confirms), no auto-override.
