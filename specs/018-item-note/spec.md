# Feature Specification: Item Row Redesign

**Feature Branch**: `018-item-note`
**Created**: 2026-05-25
**Status**: Draft
**Input**: Expanded from original item-note spec to include full ItemRow UX redesign: required items, two-line layout, max button, gross-up for % discounts, adjustments section moved to amount row.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Quick Single-Item Entry (Priority: P1)

A user records a simple expense (e.g., a utility bill or single purchase). The form opens with one item row already present. They fill in the amount, type a name (or leave it blank), and tap Max — the item amount fills automatically. They submit.

**Why this priority**: The most common daily use case. Must be as fast as no-item entry was before.

**Independent Test**: Open the entry form, fill amount NT$500, leave item name blank, tap Max → item amount = NT$500. Submit — transaction saved with one item, amount = effective_amount = 500.

**Acceptance Scenarios**:

1. **Given** the entry form opens, **When** the user views it, **Then** one item row is already present (not collapsed behind a button).
2. **Given** amount is filled and no adjustments exist, **When** the user taps Max on the single item, **Then** the item amount fills with `amountVal`.
3. **Given** item name is left blank, **When** the user submits, **Then** the transaction saves — blank item name is allowed.
4. **Given** no items are present, **When** the user taps submit, **Then** submission is blocked with a clear prompt to add at least one item.

---

### User Story 2 - Multi-Item Entry With Absolute Discount (Priority: P1)

A user buys two things and pays with a point-credit discount. They fill in the paid total, expand the discount section from the amount row, enter the discount, then add items. Max on the last item fills the correct remainder accounting for the discount.

**Why this priority**: Core scenario that motivated the Max button design.

**Independent Test**: Amount NT$450, discount NT$50, item 1 NT$300. Tap Max on item 2 → fills NT$200 (= 450 + 50 − 300). Reconciliation shows NT$450 ✓.

**Acceptance Scenarios**:

1. **Given** amount and an absolute discount are filled, **When** the user taps Max on an item, **Then** the item amount = `amountVal + Σ(absolute discounts) − Σ(other item amounts)`.
2. **Given** multiple items, **When** amounts for all but one are filled and Max is tapped on the remaining item, **Then** it fills the correct remainder.
3. **Given** Max would produce a value ≤ 0, **When** the user taps Max, **Then** the button is disabled.

---

### User Story 3 - Single-Item Entry With % Discount (Priority: P2)

A user pays NT$180 at a café that gives 10% off for card payments. They fill NT$180, expand the discount section from the amount row, set 10% discount, then tap Max on the item — the form fills the estimated original price NT$200. If the gross-up is inexact, an `≈` indicator appears and the user micro-adjusts with − / +.

**Why this priority**: Frequent use case, but requires discount to be filled before tapping Max.

**Independent Test**: Amount NT$180, 10% discount, tap Max → item amount = 200, no `≈`. Amount NT$100, 10% discount, tap Max → item amount = 112 with `≈`. Tap − → 111. Reconciliation ≈ NT$100 ✓.

**Acceptance Scenarios**:

1. **Given** a % discount is set, **When** the user taps Max, **Then** the item amount = `round(amountVal / (1 − pct/100))` (gross-up).
2. **Given** the gross-up result is fractional, **When** Max fills the value, **Then** an `≈` indicator appears next to the amount input.
3. **Given** `≈` is shown, **When** the user taps − or +, **Then** the amount adjusts by NT$1 and `≈` clears.
4. **Given** no % discount is set, **When** the user taps Max, **Then** Max uses standard formula (no gross-up).

---

### User Story 4 - Discount Section Placement (Priority: P2)

The discount/fee/refund section is hidden by default but accessible via a small expand arrow on the right side of the amount field. When expanded, it appears between the amount field and the items list — ensuring the natural fill order is amount → discount → items → Max.

**Why this priority**: Solves the ordering problem for % gross-up without disrupting users who never use discounts.

**Independent Test**: Open entry form — no discount section visible. Tap arrow on amount row → discount section expands between amount and items. Add 10% discount. Collapse and re-expand → discount row still present.

**Acceptance Scenarios**:

1. **Given** the entry form opens, **When** the user views it, **Then** the discount section is not visible.
2. **Given** the user taps the expand arrow on the amount row, **Then** the discount section appears between the amount field and the items list.
3. **Given** discount rows have been added and the section is collapsed, **When** re-expanded, **Then** previously entered rows are preserved.

---

### User Story 5 - Per-Item Note (Priority: P3)

Each item row has an optional free-text note on its second line (e.g., "加辣", "禮物", "含運費"), separate from the item name and transaction-level note.

**Why this priority**: Useful annotation; schema and UI are delivered together with the layout redesign.

**Independent Test**: Add item name "拿鐵", note "少冰". Submit. Retrieve — `name = "拿鐵"`, `note = "少冰"`.

**Acceptance Scenarios**:

1. **Given** an item row is present, **When** the user taps the note field on line 2, **Then** it accepts free text up to 200 characters.
2. **Given** the note is left empty, **When** submitted, **Then** item saves with null note — no error.
3. **Given** a note was saved, **When** retrieved, **Then** the note value is intact.

---

### Edge Cases

- Max with no amount filled: Max button disabled.
- Max with an already-filled item: overwrites silently (no confirmation).
- Multiple % discounts: gross-up uses combined rate `1 − Σ(pct/100)`.
- Mixed absolute + % discounts: Max = `round((amountVal + Σabs) / (1 − Σpct/100)) − Σother_items`.
- % discount ≥ 100: blocked at input.
- Item name blank: stored as null; allowed.
- Removing an item after others used Max: other items' amounts not auto-adjusted.

## Requirements *(mandatory)*

### Functional Requirements

**Item layout**
- **FR-001**: Each item row MUST use a two-line layout. Line 1: tag selector, name input, amount display, −, amount input, +, remove ×. Line 2: note input (flex), Max button (right-aligned).
- **FR-002**: The entry form MUST open with one item row pre-populated.
- **FR-003**: Submission MUST be blocked if the items list is empty.
- **FR-004**: Item name MAY be blank — stored as null.
- **FR-005**: Each item MUST have an optional note field (max 200 chars) on line 2; empty note stored as null.

**Max button**
- **FR-006**: Max MUST compute: `round((amountVal + Σ_absolute_adj) / (1 − Σ_pct_adj/100)) − Σ_other_item_amounts`, respecting adjustment kind (discount/refund reduce paid; fee adds).
- **FR-007**: If the gross-up division yields a fractional result, the filled amount MUST show an `≈` indicator.
- **FR-008**: `≈` MUST clear on any manual edit of the amount field (including − / + taps).
- **FR-009**: Max button MUST be disabled when computed value ≤ 0 or when amount is empty.

**− / + buttons**
- **FR-010**: − decrements item amount by NT$1; at 1 it clears to null.
- **FR-011**: + increments item amount by NT$1.

**Adjustments section placement**
- **FR-012**: The discount/fee/refund section MUST be accessible via an expand control on the amount field row.
- **FR-013**: When expanded, the section MUST appear between the amount field and the items list.
- **FR-014**: The section MUST be collapsed by default; rows MUST be preserved on collapse/re-expand.

**Schema**
- **FR-015**: `transaction_items` MUST gain a nullable `note` column (VARCHAR 200) via migration. No backfill.
- **FR-016**: The submission endpoint MUST accept and store per-item `note`; empty string normalised to null.

### Key Entities

- **`transaction_items.note`**: Nullable, max 200 chars. Per-item annotation; does not affect any computation.
- **Max value**: Derived at interaction time from current form state; not stored.
- **`≈` indicator**: UI-only ephemeral state; not stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Single-item no-discount entry requires the same number of taps or fewer as before.
- **SC-002**: Max on the last item of a multi-item absolute-discount transaction fills the correct original price — reconciliation green ✓ on first tap.
- **SC-003**: Max with a % discount fills the gross-up estimate; if inexact, `≈` appears and − / + correct it in one tap.
- **SC-004**: 0 regressions on existing entry flows (fee tab, refund tab, import).
- **SC-005**: Per-item note round-trips correctly — 100% fidelity.

## Assumptions

- Fee and refund entry tabs are out of scope — their forms are unchanged.
- Item order is insertion order (`sort_order`); drag-to-reorder is out of scope.
- `≈` is per-item state, not a global form indicator.
- Max computes from form state at moment of tap — no reactive live-update.
- Feature 019 (edit transaction) inherits this ItemRow component unchanged.
