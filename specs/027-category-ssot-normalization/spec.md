# Feature Specification: Category Single Source of Truth (B2 Normalization)

**Feature Branch**: `027-category-ssot-normalization`
**Created**: 2026-06-10
**Status**: Draft
**Input**: User description: "Normalize transaction category storage to a single source of truth (B2, follow-up to B1 commit c5bd896). Today a transaction's category lives in tx.tags (category tag first, then free tags) AND is redundantly copied onto every inheriting item's tags — the same fact stored in two places. After this feature: the category lives ONLY at tx-level as the inherited default; a transaction item stores a category tag ONLY when it genuinely overrides to a different category than the tx default; an inheriting item stores no category tag and derives its category from the transaction at read time. Changing the tx default category re-buckets all inheriting items (inheritance becomes a live reference, not a write-time snapshot); items with explicit overrides are unaffected. All write paths must stop copying the default onto inheriting items (manual entry POST, edit PUT, the invoice import-fill from feature 026, and the per-item PATCH from 026). Existing data where the category is currently copied onto items must be backfilled/normalized so reads stay correct. Known edge cases to resolve: (1) an item that genuinely belongs to 其他/uncategorized while the tx has a different default needs a representation distinct from 'inherit' (empty tags currently means inherit); (2) tx-category ≠ item-category is the intended override model, not an error; (3) the legacy tags[0] display-label fallback assumes category-first ordering — reads must stay position-independent; (4) summary aggregation must produce identical totals before and after normalization for equivalent data. Out of scope: name-based category auto-suggest (former 026 US3), making 消費時間/transaction_at editable."

## Clarifications

### Session 2026-06-10

- Q: When a user assigns an item the same category the transaction already has, is it stored as a pinned override or collapsed to inheritance? → A: Collapse to inheritance — nothing is stored; the item follows the transaction if its category changes later.
- Q: How does the per-item picker expose the three states (inherit / real override / explicitly uncategorized)? → A: Two distinct special rows — 繼承主分類 (inherit, removes the override) and 設為「其他」 (explicit-uncategorized override); the ambiguous 清除 row from feature 026 is retired.
- Q: During normalization, what happens to a category-less transaction whose categories live on its items (legacy inverse shape)? → A: Promote when unanimous — if all items share one category it becomes the transaction default and the items become inheriting; mixed-category transactions keep item-level overrides.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Re-categorize once, everything inherits (Priority: P1)

Luke realizes a transaction was filed under the wrong category — for example, a 全家 purchase whose items were all bucketed under `食:零食` when the whole trip was actually `日用:雜貨`. He changes the **transaction's** category once. Every item that was simply following the transaction's category immediately moves with it — in the edit view, the import review, and the spending summary — without him touching each item. Items he had deliberately given a *different* category keep their own category.

**Why this priority**: This is the behavioral payoff of the normalization: category inheritance becomes a live relationship instead of a stale copy made at save time. Today, changing a transaction's category strands the old category on every item, silently splitting one purchase across two buckets. It is also the story that forces the storage model to be correct, so it is the foundation everything else builds on.

**Independent Test**: Create a transaction with several items, none individually categorized. Change the transaction's category. Verify the summary moves the full transaction amount to the new category and the items display the new category — with no per-item edits.

**Acceptance Scenarios**:

1. **Given** a transaction with category A and three items that follow it (no item-level category of their own), **When** the transaction's category is changed to B, **Then** all three items display category B and the summary attributes their full spend to B.
2. **Given** a transaction with category A, one inheriting item and one item explicitly overridden to category C, **When** the transaction's category is changed to B, **Then** the inheriting item follows to B and the overridden item stays at C.
3. **Given** a transaction whose category is changed, **When** the spending summary is recomputed, **Then** the period's grand total is unchanged — only the per-category split moves.
4. **Given** a newly saved transaction with a category and items where no item was individually categorized, **When** its stored data is inspected, **Then** the category is recorded once at the transaction level and not repeated on any item.

---

### User Story 2 - Deliberate item overrides are explicit and reversible (Priority: P2)

While editing a transaction or reviewing an invoice import, Luke gives one line item a different category from the rest of the purchase (e.g., the batteries in a grocery run are `日用:雜貨` while the transaction default is `食:雜貨`). That override is stored *because he chose it*, survives later changes to the transaction's category, and can be removed — returning the item to following the transaction. He can also mark an item as genuinely belonging to the uncategorized/其他 bucket even when the transaction has a real category, and that is treated as a deliberate override, not as "no choice made".

**Why this priority**: The override model is what makes live inheritance safe to use: users must be able to pin exceptions and trust they hold. It also resolves the known ambiguity where "no item category" must now mean *inherit*, which requires a distinct way to say *explicitly uncategorized*.

**Independent Test**: On one transaction, set an item override to a different category, set another item explicitly to 其他, leave a third inheriting; then change the transaction's category and verify only the third item moves. Remove the first item's override and verify it resumes following the transaction.

**Acceptance Scenarios**:

1. **Given** an item assigned a category different from the transaction's, **When** the assignment is saved, **Then** the item keeps that category independently of later transaction-level category changes.
2. **Given** an item with an override, **When** the user removes the override ("inherit" action), **Then** the item resumes deriving its category from the transaction, including any future transaction-level changes.
3. **Given** a transaction with category A, **When** the user explicitly marks an item as uncategorized/其他, **Then** the item is bucketed under 其他 in the summary (not under A), and the system distinguishes this state from "no choice made / inherit".
4. **Given** an item assigned a category equal to the transaction's current default, **When** it is saved, **Then** it is stored as inheritance (no override is recorded) and the item follows future transaction-level category changes.
5. **Given** the existing per-item assignment surfaces (entry, edit, import review, summary list), **When** a user assigns or clears an item category, **Then** the behavior above holds on every surface consistently.

---

### User Story 3 - Existing history is normalized invisibly (Priority: P3)

Luke's existing transactions — years of imported and manually entered data where the category was copied onto items at save time — are converted to the new model. Nothing about what he *sees* changes: every historical period's summary shows the same per-category totals and the same grand totals as before the conversion. From that point on, old transactions behave like new ones: changing their category re-buckets their inheriting items.

**Why this priority**: Required for the model to be true everywhere, but it delivers no new visible capability on its own — its success is defined by nothing appearing to change. It depends on the new read/write model (US1/US2) being in place.

**Independent Test**: Capture per-category summaries for several representative historical periods, run the normalization, and verify the summaries are identical. Then change one old transaction's category and verify its inheriting items re-bucket.

**Acceptance Scenarios**:

1. **Given** a historical item whose stored category equals its transaction's category (a write-time copy), **When** the data is normalized, **Then** the item becomes an inheriting item and its summary bucketing is unchanged.
2. **Given** a historical item whose stored category differs from its transaction's category, **When** the data is normalized, **Then** the item is preserved as an explicit override.
3. **Given** any historical period, **When** per-category totals are compared before and after normalization, **Then** every category total and the grand total are identical.
4. **Given** a historical transaction with no category of its own but categorized items, **When** the data is normalized, **Then** if all items share one category it becomes the transaction's default and the items become inheriting, otherwise the items keep their categories as overrides — and in both cases its summary bucketing is unchanged.

---

### Edge Cases

- **Explicit-uncategorized vs. inherit**: "item has no category of its own" must now mean *inherit the transaction's default*. An item the user deliberately files under 其他 while the transaction has a real category needs a distinct, persistent representation. Resolved: two distinct picker actions, 繼承主分類 and 設為「其他」 (Clarifications, Session 2026-06-10). (US2, scenario 3.)
- **Override equal to the default**: a user can pick the same category for an item that the transaction already has. Resolved: collapsed to inheritance at write time (Clarifications, Session 2026-06-10) — the item follows future transaction-level changes.
- **Transaction with no category but categorized items**: the inverse shape exists in legacy data (item-level categories drove the summary; the transaction itself had none). Resolved: normalization promotes the unanimous item category to the transaction default (items become inheriting); mixed-category transactions keep item overrides (Clarifications, Session 2026-06-10). Bucketing stays intact either way; promoted transactions newly display a transaction-level category, which is intended.
- **Display labels must not depend on storage order**: any place that shows "the transaction's category" or "the item's category" must derive it by meaning, not by position in a stored list; legacy position-based fallbacks must keep working for data that still has them.
- **Mixed-era data during rollout**: between deploy and backfill completion, reads must be correct for both the old (copied) and new (normalized) shapes simultaneously.
- **Linked fee/refund transactions**: a fee or refund linked to a parent transaction copies the parent's tags when linked. These are separate transactions, so they keep their own category snapshot — cross-transaction inheritance is *not* introduced by this feature. Changing the parent's category afterward does not re-bucket an already-linked fee/refund.
- **Free (non-category) labels on items**: items can carry plain labels alongside a category; removing the redundant category copy must not disturb those labels.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST treat the transaction-level category as the single authoritative default for the transaction and all of its items.
- **FR-002**: An item MUST derive its effective category at read time: its own explicit override if present, otherwise the transaction's category, otherwise uncategorized (其他).
- **FR-003**: Every path that records or edits a transaction or its items (manual entry, transaction edit, invoice import auto-fill, per-item category assignment) MUST stop writing the transaction's default category onto inheriting items.
- **FR-004**: An item MUST be able to carry an explicit category override that differs from the transaction's default, and that override MUST be unaffected by later changes to the transaction's category.
- **FR-005**: The system MUST provide a persistent representation of "explicitly uncategorized" for an item that is distinct from "inheriting"; an item in that state MUST be bucketed under 其他 regardless of the transaction's category.
- **FR-006**: Users MUST be able to remove an item's override, returning it to live inheritance of the transaction's category.
- **FR-007**: Changing a transaction's category MUST re-bucket all of its inheriting items (in displays and in summary aggregation) without per-item edits, and MUST NOT change the period's grand total.
- **FR-008**: Summary aggregation MUST produce identical per-category and grand totals for the same underlying purchases whether the data is in the old (copied) or new (normalized) shape.
- **FR-009**: A one-time normalization MUST convert existing data: item categories equal to their transaction's category become inheritance (the copy is removed); item categories different from the transaction's are preserved as overrides; for a category-less transaction whose items all share one category, that category is promoted to the transaction default and the items become inheriting (mixed-category transactions keep their item categories as overrides); non-category labels on items are preserved untouched.
- **FR-010**: The normalization MUST be verifiable: per-category and grand totals for historical periods MUST be demonstrably identical before and after it runs.
- **FR-011**: All user surfaces that display a category (entry, edit, import review, summary transaction list) MUST show the item's *effective* category per FR-002, and MUST NOT rely on the category occupying a particular position in stored label lists.
- **FR-012**: During the period when old-shape and new-shape data coexist, all reads MUST be correct for both shapes.
- **FR-013**: Assigning an item a category equal to the transaction's current default MUST be stored as inheritance (no override recorded); the item follows future transaction-level category changes.
- **FR-014**: The per-item category picker MUST offer two distinct, mutually reversible actions — 繼承主分類 (return to inheriting the transaction's category) and 設為「其他」 (explicitly uncategorized override) — replacing the single ambiguous "clear" action; the same affordance MUST appear on every surface where an item's category can be assigned.

### Key Entities

- **Transaction**: a purchase with an amount, date, and a list of labels; exactly one label may be a category (major:sub from the catalog) — under this feature it is the authoritative default for the whole transaction. Other labels are free-form (e.g., vendor, 訂閱).
- **Transaction Item**: a line item belonging to a transaction, with a name, amount, and labels. Under this feature, a category label on an item exists only as a deliberate override (or the distinct "explicitly uncategorized" marker); absence of a category label means *inherits the transaction's category*. Free-form labels remain allowed.
- **Category**: an entry in the managed catalog (`major:sub`, ~137 rows, live-DB managed). Unchanged by this feature.
- **Spending Summary**: per-period aggregation of effective amounts into category buckets plus an 其他 remainder; consumes *effective* categories per FR-002.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Re-categorizing a whole transaction takes exactly one user action regardless of item count (today: 1 + one per item), and the result is reflected in the summary immediately.
- **SC-002**: After normalization, 100% of historical periods show per-category totals and grand totals identical to their pre-normalization values.
- **SC-003**: After normalization and under the new write paths, zero items store a category identical to their transaction's default; every stored item category represents a user decision to differ (or the explicit-uncategorized state).
- **SC-004**: 100% of pre-existing intentional overrides (item category ≠ transaction category) survive normalization unchanged.
- **SC-005**: Changing a transaction's category never changes the period grand total, only its distribution across categories.

## Assumptions

- **Override-equal-to-default is collapsed to inheritance at write time** (confirmed in clarification): if a user assigns an item the same category the transaction already has, it is stored as inheritance (no override). Rationale: "follow the transaction" is the dominant intent; a pinned-even-if-equal override adds a state users can't see.
- **"Explicitly uncategorized" is represented as a real, persistent override state** (bucketed to 其他), selected via a dedicated 設為「其他」 picker row and removed via 繼承主分類, on the same per-item picker surfaces shipped in feature 026 (confirmed in clarification).
- **A transaction with no category and no item overrides** is uncategorized (其他) for its full amount — same as today.
- **Legacy inverse-shape data** (no transaction category, categorized items): normalization promotes the item category to the transaction level when all items agree (confirmed in clarification); mixed-category transactions keep item-level overrides and continue to work through read-time derivation.
- **Cross-transaction tag copying for linked fees/refunds remains snapshot behavior** — out of scope to make it live.
- **The category catalog and taxonomy rules are unchanged**; this feature changes where a category is stored, not what categories exist.
- **Out of scope**: name-based category auto-suggest (former 026 US3); making 消費時間 (transaction time) editable; any change to invoice matching or amounts.
