# Feature Specification: Entry Fee/Refund Layout Alignment + Major-Category Selector

**Feature Branch**: `042-entry-layout-category`
**Created**: 2026-06-29
**Status**: Draft
**Input**: User description: "Entry 手續費/退款 版面對齊已產出的 Claude Design + 主類別選擇器溢位/常用排序（合併一個 feature）"

## Overview

Two presentation-layer improvements to the entry (記帳) experience, bundled because they touch the same screens and shared component:

- **A. 手續費 / 退款 layout alignment** — the design round-trip already produced a unified layout for these two tabs (synced to `pwa/design-preview/refined/entry-fee/optimized.html`, `entry-refund/optimized.html`, `analysis/fee-refund.html`). A prior feature shipped only the auto-fill *behavior*; the *layout* was never built, so the two tabs still have inconsistent field order and the "link original transaction" control sits at the bottom. This feature brings the layout up to the design.
- **B. Major-category selector** — the major-category row currently scrolls horizontally and hides options off-screen on mobile. Replace it with a compact, frequency-ranked set of always-visible options plus an overflow opener.

No database or recorded-data changes — this is purely how the entry screens present and order things.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consistent fee/refund flow led by the linked original (Priority: P1)

When recording a 手續費 (fee) or 退款 (refund), the person sees the same field order on both tabs, and the **link to the original transaction is the first thing after the amount** — presented as a prominent card. Linking an original fills in the downstream fields (payment channel, category for fee, suggested description), which now appear *below* the link in a logical top-to-bottom flow.

**Why this priority**: This is the core of the feature and the originally designed-but-unbuilt experience. Today the link is the last field even though it drives everything above it, which is backwards and inconsistent between the two tabs.

**Independent Test**: Open 手續費 and 退款 tabs; confirm both present fields in the order 金額 → 連結原始交易 → 付款管道 → (分類, fee only) → 說明, with the link rendered as a card directly under the amount. Link an original and confirm downstream fields populate and remain editable.

**Acceptance Scenarios**:

1. **Given** the 手續費 tab, **When** it opens, **Then** the fields appear in order: 金額, 連結原始交易, 付款方式, 分類, 說明.
2. **Given** the 退款 tab, **When** it opens, **Then** the fields appear in order: 金額, 連結原始交易, 退款至, 說明 (no category field).
3. **Given** either tab with no original linked, **When** the person searches and selects an original, **Then** the link is shown as a card (icon, the original's description, payment method, category, amount, date) with a clear control to remove the link, and the untouched downstream fields populate from it.
4. **Given** a linked original, **When** the person taps the remove-link control, **Then** the link is cleared and previously entered values remain unchanged.
5. **Given** a field the person has manually edited, **When** they link or re-link an original, **Then** that edited field is not overwritten (existing non-destructive, create-time behavior is preserved).

---

### User Story 2 - Find the right major category fast on mobile (Priority: P1)

When choosing a category, the person sees their **most-used major categories first**, as a small always-visible set that fits without horizontal scrolling, plus a "more" opener that reveals the full list. Sub-categories are likewise ordered most-used-first.

**Why this priority**: The current horizontal-scroll row hides later options off-screen on mobile; the most-used aren't necessarily reachable without scrolling. This directly affects every expense and fee entry.

**Independent Test**: On a narrow mobile viewport, open the category selector; confirm the major row fits on screen without horizontal scrolling, shows the most-used majors first, and a "more" control opens the full list of majors. Confirm sub-category chips are ordered most-used-first.

**Acceptance Scenarios**:

1. **Given** a mobile-width screen, **When** the category selector renders, **Then** the major-category options fit without horizontal scrolling and the full set is reachable via a "more" opener.
2. **Given** historical entries, **When** the major row renders, **Then** the always-visible majors are the most frequently used, ordered by frequency.
3. **Given** the "more" opener is tapped, **When** the overflow view appears, **Then** it lists all major categories (each with its icon) and selecting one closes the overflow and selects that major.
4. **Given** a selected major with many sub-categories, **When** the sub-category chips render, **Then** they are ordered most-used-first.
5. **Given** a person with no history (new/empty data), **When** the selector renders, **Then** it falls back to a stable default order without error.

---

### User Story 3 - Direction-aware money cues and readiness feedback (Priority: P2)

The amount on the 手續費 tab is framed as an added cost, while the 退款 tab frames the amount as money coming back (distinct visual treatment). Both tabs show an inline readiness hint above the submit button confirming required fields are complete.

**Why this priority**: Polish that reduces cross-tab confusion (which direction the money moves) and makes "can I submit now?" obvious. Valuable but secondary to the structural layout (US1).

**Independent Test**: Compare the amount treatment on 手續費 vs 退款; confirm the fee amount reads as an added cost and the refund amount reads as a return. Fill required fields and confirm the inline readiness hint appears above submit.

**Acceptance Scenarios**:

1. **Given** the 手續費 tab, **When** entering the amount, **Then** it is labeled/framed as an added cost.
2. **Given** the 退款 tab, **When** entering the amount, **Then** it is framed as a returned amount (distinct from the fee/expense treatment).
3. **Given** required fields are complete on either tab, **When** the form is valid, **Then** an inline confirmation appears above the submit button.
4. **Given** the 退款 tab with an original linked, **When** the person uses the full-refund control, **Then** the amount is set to the original's amount (existing behavior preserved), and the link card also surfaces the original amount and a full/partial indication.

---

### Edge Cases

- **Long original description / many details in the link card**: the card must remain within the mobile width (truncate gracefully) without breaking layout.
- **Linked original has no resolvable single category (fee)**: the category is left for manual selection (existing behavior); the layout must still render correctly.
- **Major name without a defined icon**: renders without an icon (graceful fallback), both in the always-visible row and the overflow view.
- **Ties in usage frequency**: ordering is deterministic (stable tie-break) so the row does not reshuffle unpredictably between renders within a session.
- **Frequency recomputation**: ordering is computed once per app session; adding a new entry does not visibly reshuffle the row mid-session.
- **Refund description left empty**: submission is blocked (refund description remains required); fee description left empty is allowed (defaults applied as today).

## Requirements *(mandatory)*

### Functional Requirements

**A. Fee/Refund layout**

- **FR-001**: The 手續費 and 退款 tabs MUST present fields in a single shared order: 金額 → 連結原始交易 → 付款管道 → (分類, 手續費 only) → 說明.
- **FR-002**: 說明 MUST be the last field on both tabs.
- **FR-003**: The 連結原始交易 control MUST appear immediately below 金額 and be presented as a card showing the linked original's description, payment method, category, amount, and date, with a control to remove the link.
- **FR-004**: Linking, re-linking, and clearing an original MUST preserve the existing non-destructive, create-time auto-fill behavior (untouched fields populate from the original; touched fields are never overwritten; nothing is changed after submission).
- **FR-005**: The 退款 tab MUST keep its one-tap full-amount action, and the link card MUST surface the original amount with a full/partial refund indication.
- **FR-006**: 退款 說明 MUST remain required; 手續費 說明 MUST remain optional (defaulting as today). (Resolves the design's open "說明 required-consistency" question — kept intentionally different.)
- **FR-007**: Both tabs MUST show an inline readiness confirmation above the submit button when required fields are complete.
- **FR-008**: The 手續費 amount MUST be framed as an added cost and the 退款 amount MUST be framed as a returned amount, visually distinct from one another.

**B. Major-category selector**

- **FR-009**: The major-category selector MUST present an always-visible set of options that fits a mobile width without horizontal scrolling, plus a "more" opener to the full list.
- **FR-010**: The always-visible majors MUST be the most frequently used, ordered by usage frequency (highest first).
- **FR-011**: The "more" opener MUST reveal all major categories, each with its icon, and selecting one MUST select that major and close the overflow view.
- **FR-012**: Sub-category options MUST be ordered by usage frequency (highest first).
- **FR-013**: Usage frequency MUST be derived from the person's existing recorded entries, computed once per app session (not requiring any new server capability).
- **FR-014**: When no usage history exists, the selector MUST fall back to a stable default order without error.
- **FR-015**: Category usage ordering MUST apply consistently everywhere the category selector is used (it is a shared control).

**Cross-cutting**

- **FR-016**: All newly introduced visible text MUST be provided in both supported languages (zh + en).
- **FR-017**: The feature MUST NOT change stored category data or category names (single-character major names retained); it changes presentation and ordering only.

### Key Entities *(include if feature involves data)*

- **Category usage ranking**: a derived, per-session ranking of major and sub-categories by how often the person has used them, computed from existing recorded entries. Not persisted; recomputed on app load.
- **Linked original (reference)**: the existing-transaction reference shown in the link card (description, payment method, category, amount, date). Read-only context for the fee/refund being created.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The 手續費 and 退款 tabs present an identical field order (金額 → 連結 → 付款管道 → [分類] → 說明), verifiable by inspection on both tabs.
- **SC-002**: On a mobile-width screen, all major-category options are reachable with **zero horizontal scrolling** (always-visible set + "more").
- **SC-003**: When linking an original, the number of fields the person must fill manually is reduced (payment channel, and category for fee, arrive pre-filled), measured as fewer required manual touches than the pre-feature flow.
- **SC-004**: The most-used major categories appear in the always-visible set for a person with representative history (top-used majors are reachable without opening "more" in the common case).
- **SC-005**: No regression in submit validation: refund still cannot be submitted without a description; fee can; amount still required on both.
- **SC-006**: The shipped layout matches the synced design references for both tabs (field order, link card, direction cues, readiness hint).

## Assumptions

- **Always-visible count**: the always-visible major set is small enough to fit one mobile row (≈3–4 with the emoji-prefixed single-character names); the exact count is tuned during implementation to the fit criterion in FR-009/SC-002.
- **Frequency window**: usage frequency is computed from the entries already available to the app at load; an all-history count is acceptable for v1 (a recency-weighted window is a possible later refinement, not required here).
- **Shared component reach**: because the category selector is shared, the ordering/overflow change applies to every screen that uses it (expense entry, fee entry, and any edit surfaces). This is intended and consistent.
- **Behavior baseline**: the auto-fill semantics (non-destructive, create-time only, touched-flag gating, full-refund one-tap, single-category resolution for fee) are inherited unchanged from the prior feature; this feature only relocates/repackages them visually.
- **Design source of truth**: the synced refined mockups + analysis (`pwa/design-preview/refined/entry-fee|entry-refund/optimized.html`, `analysis/fee-refund.html`) are the pixel/structure reference. Where the mockup re-introduces previously-rejected ideas, the established project decisions win (e.g., single-character major names retained).
- **Out of scope**: 支出-tab-only refinements (copy-most-recent quick action, category-specific suggested-tag pills), SummaryScreen, and scheduled reminders are not part of this feature.
