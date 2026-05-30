# Research: Item Row Redesign (018)

## Decision 1 — Max button formula

**Decision**: `maxItem = round((amountVal + Σabs_gross) / (1 − Σpct_gross/100)) − Σother_items`

Where:
- `Σabs_gross` = sum of absolute discount/refund amounts (they inflate gross; fees subtract)
- `Σpct_gross` = sum of percentage discount rates (fees add to denominator)
- Both derived from the `adjustments` array in form state at tap time

**Rationale**: Reconciliation identity is `amountVal = itemSum × (1 − Σpct/100) − Σabs_discounts − Σabs_refunds + Σabs_fees`. Solving for the target item amount (treating other items as fixed) gives the formula above. Consistent with existing `resolveAdjAmount` logic in `AdjustmentRow`.

**`≈` indicator**: Set when `(amountVal + Σabs_gross) % (1 − Σpct_gross/100) !== 0` — i.e., the gross-up division is not exact. Cleared on any manual edit of the item amount (input change, − / + tap).

**Disabled**: When `amountVal === 0` or computed value ≤ 0.

---

## Decision 2 — Two-line ItemRow layout

**Decision**: `flex-col` wrapper; line 1 = existing row (tag, name, −, amount, +, ×); line 2 = note input (flex) + Max button (right-aligned).

**Rationale**: Preserves existing line-1 tap targets. Line 2 is visually subordinate — lighter text, smaller size. Max sits right because it's the "fill" action, analogous to an action button.

**Alternative**: Single row with Max inline — rejected; too wide on mobile with name, note, and Max all on one line.

---

## Decision 3 — Adjustments section placement

**Decision**: Replace `<details>` with inline toggle. Chevron button (▾/▸) on the right of the amount field row controls `showAdj` boolean state. Section renders between amount field and items list when open.

**Rationale**: Natural fill order becomes amount → discount → items → Max. When % discount is set before tapping Max, gross-up works correctly. Previous bottom placement caused the ordering problem described in the spec.

**Implementation**: Remove `<details>` wrapper. Add `const [showAdj, setShowAdj] = useState(false)` in ExpenseForm. Render `{showAdj && <div>...</div>}` in the correct position.

---

## Decision 4 — `ItemRowData` extension

**Decision**: Add `note: string` and `approxFlag: boolean` to `ItemRowData`.

- `note`: bound to line-2 input; sent to backend; empty string normalised to null before submit
- `approxFlag`: set by `onMax`; cleared by any manual amount edit; not sent to backend

`onMax` is passed as a prop from `ExpenseForm` — it needs access to `adjustments` state to compute the formula. ItemRow receives `onMax: (() => void) | null` and calls it; the computation lives in `ExpenseForm`.

---

## Decision 5 — Pre-populated item row

**Decision**: `useState<ItemRowData[]>([newItem()])` — one blank item on mount.

**Rationale**: FR-002. The spec requires this to keep single-item entry as fast as before.

**Reset on submit**: `setItems([newItem()])` (not `[]`) so the form is ready for the next entry.

---

## Decision 6 — Backend guard: category tags in free_tags

**Decision**: In `pwa.ts`, add `.filter(t => !t.includes(':'))` to `free_tags` after trim.

```ts
const free_tags = rawTags
  .map((t) => t.replace(/^[#\s]+|[#\s]+$/g, ''))
  .filter(Boolean)
  .filter((t) => !t.includes(':'));   // category tags belong only on items
```

**Rationale**: Fixes the audit `category_tag_on_transaction` bug found in post-016 data. Category tags (format `major:subcategory`) are only valid on items, not on transaction-level tags.

---

## Decision 7 — `transaction_items.note` column

**Decision**: `ALTER TABLE transaction_items ADD COLUMN note TEXT CHECK (char_length(note) <= 200);`

Nullable, no backfill, no default. `insertTransactionItems` gains optional `note?: string | null`; all existing callers unaffected (pass nothing → NULL).

**Alternative**: `VARCHAR(200)` — TEXT with CHECK is equivalent in PostgreSQL and matches the pattern used in this codebase.
