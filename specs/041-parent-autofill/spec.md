# Feature Specification: 連結原始交易 auto-fill (parent-transaction auto-fill for fee/refund)

**Feature Branch**: `041-parent-autofill`
**Created**: 2026-06-28
**Status**: Draft
**Input**: User description: "連結原始交易 auto-fill for fee/refund adjustments on the Entry screen — when a user links an original transaction, pre-fill the adjustment form from the linked parent so they don't re-key what's already known."

## User Scenarios & Testing *(mandatory)*

Context: On the Entry screen, the **手續費 (fee)** and **退款 (refund)** tabs both let the user link an *original transaction* ("連結原始交易") via a search box. Today, linking only records the relationship — none of the parent's known details flow into the form, so the user re-enters the payment method (and, for a fee, the category) by hand even though the original already has them. This feature makes the link pre-fill what is already known.

**Guiding principle (from clarification)**: auto-fill is a *create-time convenience only*. It assists while composing an unsubmitted fee/refund and never overrides a field the user has touched. Once the entry is submitted, the only surviving relationship is the parent link itself — nothing is ever back-filled or re-synced afterward.

### User Story 1 - Payment method flows from the linked original (Priority: P1)

When entering a fee or a refund and linking the original transaction, the payment method is set automatically to match the original. A refund goes back to the card/account it was paid on; a fee is charged to that same method — so the original is the authoritative source and the user should not have to re-pick it.

**Why this priority**: This is the most common and least ambiguous saving. The payment method always exists on the original, applies to both tabs, and is the field most likely to be re-entered identically. Delivers value on its own.

**Independent Test**: On either tab, enter an amount, link an original transaction whose payment method differs from the form default, and confirm the payment method updates to the original's without further action — then submit successfully.

**Acceptance Scenarios**:

1. **Given** the 退款 tab with payment method at its default, **When** the user links an original paid by a non-default method, **Then** the "退款至" payment method switches to the original's method.
2. **Given** the 手續費 tab, **When** the user links an original, **Then** the payment method switches to the original's method.
3. **Given** an auto-filled payment method that the user then changes by hand, **When** the user re-links to a different original, **Then** the user's manual choice is preserved (auto-fill never overrides a touched field).

---

### User Story 2 - Category flows from the linked original on a fee (Priority: P2)

When entering a **fee** and linking the original, the fee's category is set to the original's category — but only when the original resolves to a single, unambiguous category. A fee (e.g. 國外交易服務費 on an overseas purchase) usually belongs to the same category as the purchase it rode on, so inheriting it removes a multi-tap category selection.

**Why this priority**: High value but narrower than P1 — it applies only to the 手續費 tab (the 退款 tab has no category field) and only when the original has exactly one category. Many originals are multi-item with several categories, where no single answer exists.

**Independent Test**: On the 手續費 tab, link a single-category original and confirm the category is pre-selected; link a multi-category original and confirm the category is left for the user to choose.

**Acceptance Scenarios**:

1. **Given** the 手續費 tab with no category chosen, **When** the user links an original that has exactly one distinct category, **Then** the fee's category is set to that category.
2. **Given** the 手續費 tab, **When** the user links an original with multiple distinct categories (or none / uncategorized), **Then** the category is left unchanged for the user to pick.
3. **Given** a fee whose category was auto-filled, **When** the user changes the category by hand, **Then** the manual choice is kept.

---

### User Story 3 - One-tap full refund amount (Priority: P2)

On the **退款** tab, once an original is linked, a 「全額退款」 (full refund) action lets the user fill the amount with the original's full amount in one tap, instead of typing it. The amount stays editable afterward. This is refund-only and only available when an original is linked (the full amount comes from the original).

**Why this priority**: Full refunds are common and the original's total is exactly the right value in that case; a one-tap fill removes manual entry without making the (often-partial) auto-fill of amount the default.

**Independent Test**: On the 退款 tab, link an original, tap 「全額退款」, and confirm the amount becomes the original's full amount and can still be edited.

**Acceptance Scenarios**:

1. **Given** the 退款 tab with an original linked, **When** the user taps 「全額退款」, **Then** the amount is set to the original's full amount.
2. **Given** no original is linked on the 退款 tab, **When** the user looks for 「全額退款」, **Then** it is not available (there is no source amount).
3. **Given** the amount was filled by 「全額退款」, **When** the user edits the amount, **Then** the edit is kept (e.g. to record a partial refund instead).

---

### User Story 4 - Description flows from the linked original on a refund (Priority: P3)

When entering a **refund** and linking the original, the description is pre-filled from the original's label (its note / item name / tag) if the user has not already typed one. This brings the 退款 tab to parity with the 手續費 tab, which already does this.

**Why this priority**: Convenience parity, lowest risk. The 手續費 tab already behaves this way; this extends the same non-destructive fill to 退款. Description is required on the refund tab, so a sensible default speeds entry.

**Independent Test**: On the 退款 tab with an empty description, link an original and confirm the description fills with the original's label; repeat with a description already typed and confirm it is not overwritten.

**Acceptance Scenarios**:

1. **Given** the 退款 tab with an empty description, **When** the user links an original, **Then** the description fills from the original's label.
2. **Given** the 退款 tab with a description already typed, **When** the user links an original, **Then** the typed description is preserved.

---

### Edge Cases

- **Original is itself a fee** (a refund may reverse part of an earlier fee): the fee's payment method/label/amount are used the same way; a fee always has a single category, but since the 退款 tab has no category field, only payment / description / 全額退款 apply.
- **Original is uncategorized (未分類)**: no category to inherit — the fee's category is left unchanged.
- **Original expense has multiple line-item categories**: no single category — category is left unchanged (User Story 2).
- **User changes the linked original mid-entry**: auto-fill re-applies only to fields the user has not manually set; touched fields are preserved.
- **User clears the link entirely**: current field values are left intact (clearing does not wipe the form).
- **After submit**: the saved fee/refund keeps only the parent link; no later change to the original ever back-fills or alters the saved entry.
- **Partial fees/refunds**: the amount is never auto-filled; the user types the actual amount (refund users may instead tap 全額退款 then trim).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the user links an original transaction in the 手續費 or 退款 tab, the system MUST set the form's payment method to the original's payment method.
- **FR-002**: All auto-filled values MUST remain editable; the user can override any auto-filled field after linking.
- **FR-003**: Auto-fill MUST NOT overwrite any field the user has set manually. Auto-fill runs each time an original is linked and populates only fields the user has not manually changed.
- **FR-004**: In the 手續費 tab, when the linked original resolves to exactly one distinct category, the system MUST set the fee's category to that category; when it resolves to multiple categories or none, the category MUST be left unchanged.
- **FR-005**: The 退款 tab has no category field; category auto-fill MUST NOT apply there.
- **FR-006**: The system MUST pre-fill the description from the original's label only when the description is empty — preserving the existing 手續費 behavior and extending the same behavior to 退款.
- **FR-007**: The system MUST NOT auto-fill the amount from the original on either tab.
- **FR-008**: The 退款 tab MUST offer a 「全額退款」 quick-fill action that sets the amount to the linked original's full amount in one step; it MUST be available only when an original is linked, and the resulting amount MUST remain editable. This action does not exist on the 手續費 tab.
- **FR-009**: Auto-fill is a create-time aid only. When the user changes the linked original while composing, the system MUST re-apply auto-fill per FR-003 (untouched fields only); when the user clears the link, the system MUST leave current values intact; after the entry is submitted, the system MUST NOT back-fill or re-sync any field from the original.
- **FR-010**: The information needed to auto-fill (the original's payment method, its single-category-or-none, its label, and — for 全額退款 — its full amount) MUST be available to the form at link time, without any change to the database schema (the schema is the source of truth and stays fixed).

### Key Entities *(include if feature involves data)*

- **Original transaction (the linked "parent")**: the prior expense or fee the adjustment attaches to. Relevant attributes for this feature: payment method (exactly one), a resolved category (a single category, or none when ambiguous/uncategorized), a human label (note / item name / tag), and full amount (consumed only by 全額退款).
- **Adjustment entry (fee or refund being created)**: amount (user-entered; refund offers 全額退款 one-tap fill), payment method (auto-fillable), description (auto-fillable when empty), category (fee only, auto-fillable when unambiguous), and the link to the original.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For fee/refund entries that link an original, the payment method matches the original without any manual selection in at least 95% of entries.
- **SC-002**: For fee entries linked to a single-category original, the category is pre-filled correctly so that no manual category selection is needed for those entries.
- **SC-003**: Linking an original reduces the number of manual field selections required to complete a fee/refund entry (payment method, and category where applicable, are eliminated as manual steps).
- **SC-004**: Auto-fill never silently overwrites a value the user has typed or selected — zero such incidents in testing.
- **SC-005**: A full refund of a linked original can be entered with a single tap for the amount (via 全額退款) rather than typing it.
- **SC-006**: When the user chooses not to link an original, the entry flow has no added steps versus today.

## Assumptions

- **Amount is never auto-filled**: fees and refunds are commonly partial, so the user always enters the amount — except the refund-only 全額退款 one-tap fill.
- **Non-destructive fill**: auto-fill populates only fields the user has not manually changed, and everything stays editable.
- **Create-time only**: auto-fill assists composition; after submit, only the parent link persists and nothing is back-filled.
- **No database schema change**: the parent-search data feeding the form is extended to carry the payment method, resolved category, label, and full amount; the underlying schema is unchanged.
- **The original always has exactly one payment method** (a transaction-level attribute), so payment-method auto-fill is unambiguous.
- **Scope is the PWA Entry screen only** (手續費 and 退款 tabs) plus the supporting parent-search data; no changes to other surfaces.
- This feature was deferred from spec 031 (Entry UX refinement) as the Claude Design round-trip's main proposal.
