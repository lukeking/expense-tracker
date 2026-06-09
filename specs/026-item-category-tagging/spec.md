# Feature Specification: Usable item-level category assignment

**Feature Branch**: `026-item-category-tagging`
**Created**: 2026-06-09
**Status**: Draft
**Input**: User description: "(1) The per-item category picker shown beside each item is hard to use — it lists every category value flat, ungrouped by major, with no search. Example: bought a popsicle and a pudding at FamilyMart, tagged the transaction only with the plain store tag `全家`; when adding items there was no fast way to pick each item's category. It needs search (with type-ahead) and/or filter by major category. (2) Edge case: bought four differently-categorized things at FamilyMart, again tagged only `全家`, didn't write items, and let month-end invoice import auto-match and auto-generate the items. Those auto-generated items carry no `major:sub` category, so in category statistics their spend disappears into 其他 / uncategorized."

## Clarifications

### Session 2026-06-09

- Q: Should User Story 3 (name-based category suggestion) be in scope? → A: No — defer it. Deliver only the deterministic improvements: the searchable/filterable picker (Story 1) and import-review visibility + assignment for uncategorized invoice items (Story 2). No auto-suggestion, no LLM.
- Q: How should uncategorized invoice items be assigned a category? → A: Inline during import. The import review must show each matched transaction's item categories, visibly flag uncategorized auto-filled items, and let the user tap one to assign a category (via the Story 1 picker) without leaving the import screen or re-importing. (Assigning later through the normal transaction editor remains possible but is not the primary flow.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Quickly pick the right category for an item (Priority: P1)

When adding or editing the items of a transaction, the user opens the small category control beside an item and needs to assign it a category (e.g. `飲食:零食`). Today that control shows one long, flat list of every major and every `major:sub` value in the catalog, with no grouping and no search, so finding the right one is slow and error-prone. The user wants to either type to find a matching category (type-ahead) or first pick a major category and then choose among only its subcategories.

**Why this priority**: This is the foundational interaction the user hits every time they categorize an item, in both manual entry and when fixing up imported transactions. It delivers standalone value (faster, less frustrating item categorization) and is what makes Story 2 pleasant rather than tedious.

**Independent Test**: Open a transaction's item editor, open the category control for an item, type part of a subcategory name and confirm only matching categories are offered; alternatively tap a major and confirm only that major's subcategories are offered. Pick one and confirm it is applied to the item.

**Acceptance Scenarios**:

1. **Given** the item category control is open and the catalog has many categories, **When** the user types part of a category name, **Then** only categories whose major or subcategory matches the typed text are shown, updating as they type.
2. **Given** the item category control is open, **When** the user selects a major category, **Then** the control narrows to that major's subcategories (plus the option to use the major alone).
3. **Given** an item currently inherits its transaction's category, **When** the user opens the control, **Then** the "inherit transaction category" option is clearly available and selecting it leaves no per-item override.
4. **Given** an item already has a category override, **When** the user opens the control, **Then** the current selection is indicated and can be changed or cleared.
5. **Given** the transaction's other items or tags already use a category that is not (or no longer) in the catalog, **When** the user searches/filters, **Then** that already-present category remains selectable so existing data is not lost.

---

### User Story 2 - Invoice-auto-generated items don't vanish from category statistics (Priority: P2)

The user buys several differently-categorized things at one store, tags the transaction only with a plain store tag (e.g. `全家`), and deliberately skips writing items. At month-end they import the e-invoice; because amount and date are well-calibrated, the import auto-matches the transaction and auto-generates one item per invoice line. Those generated items carry no `major:sub` category and the transaction has no category tag to inherit, so in category statistics all of that spend collapses into 其他 / uncategorized instead of the real categories. Today the import review doesn't even show item categories clearly, so the user can't tell which items lack one. The fix lives in that same import review: it must show each matched transaction's item categories, visibly flag the uncategorized auto-filled items, and let the user assign a category to each one **inline, during import**, without re-importing or leaving the import screen.

**Why this priority**: This is a correctness problem (real spend is mis-attributed to 其他), but it builds on Story 1's picker to be usable, so it follows it. It is independently valuable: even alone it stops invoice-derived spend from silently disappearing from category breakdowns.

**Independent Test**: Import an invoice that auto-matches a transaction tagged only `全家` with no items, producing several auto-generated items. In the import review, confirm each item's category is shown and the uncategorized ones are flagged; assign each a category inline; then confirm the category summary moves their spend out of 其他 into the assigned categories.

**Acceptance Scenarios**:

1. **Given** an invoice import auto-generated items for a transaction whose tags contain no category, **When** the user looks at that transaction in the import review, **Then** each item's category (`major:sub`) is shown and the items lacking one are visibly flagged as needing a category.
2. **Given** such flagged items in the import review, **When** the user taps one and picks a category with the Story 1 picker, **Then** the category is saved to that item inline — without re-importing or leaving the import screen — and the flag clears.
3. **Given** an uncategorized auto-generated item, **When** the user assigns it a category and the period summary is viewed, **Then** that item's spend is counted under the assigned category/subcategory and no longer under 其他.
4. **Given** an auto-generated item the user has not yet categorized, **When** the period summary is viewed, **Then** its spend is still represented (under 其他) and never dropped from totals.
5. **Given** the user assigns different categories to several items of the same transaction, **When** the summary is viewed, **Then** each item's net spend is attributed to its own assigned category.

---

### Edge Cases

- **Large catalog**: With many majors and subcategories, search/filter must still surface the intended category quickly (the core motivation for Story 1).
- **Transaction has both a store tag and a category tag** (e.g. `全家` + `飲食:超商`): items legitimately inherit the category and are NOT flagged as uncategorized.
- **Item with no amount** (approximate / "Max" item): can still be categorized; its spend attribution follows the existing net-amount and remainder rules unchanged.
- **Item assigned a category later removed from the catalog**: existing assignments remain valid and continue to count toward that category; they are not silently cleared.
- **Mixed transaction**: some auto-generated items categorized, some not — categorized items count to their categories, the uncategorized remainder still shows under 其他.
- **Refund / negative transactions**: assigning categories to their items attributes the (negative) spend to those categories consistently with existing summary behavior.
- **No category selected (inherit)**: an item left to inherit a transaction that itself has no category is treated as uncategorized for statistics, consistent with Story 2.

## Requirements *(mandatory)*

### Functional Requirements

**Item category picker (Story 1)**

- **FR-001**: The per-item category control MUST let the user filter options by typing, showing only categories whose major or subcategory text matches the query and updating as the user types.
- **FR-002**: The per-item category control MUST let the user narrow options by selecting a major category, after which only that major's subcategories (and the major itself) are offered.
- **FR-003**: The control MUST present categories organized by major (grouped or filterable) rather than as a single undifferentiated list of every value.
- **FR-004**: The control MUST keep the existing options to (a) inherit the transaction's category (no per-item override) and (b) clear an existing override, with the current state clearly indicated.
- **FR-005**: Search/filter MUST consider the full category catalog plus any category already present on the transaction's items or tags, so values not in the current catalog remain selectable.
- **FR-006**: The improved control MUST apply everywhere items are categorized — both creating a new transaction and editing an existing/imported one.

**Categorizing invoice-auto-generated items (Story 2)**

- **FR-007**: The system MUST identify an item as "uncategorized" when the item has no `major:sub` category and its transaction has no category tag for it to inherit.
- **FR-008**: The import review MUST display each matched transaction's item categories (`major:sub`) and visibly flag items that are uncategorized (including items created by invoice auto-fill), without requiring the user to expand or hunt for them.
- **FR-009**: The user MUST be able to assign a category to a flagged uncategorized item directly from the import review (inline, using the Story 1 picker), persisting it to that item without re-importing or navigating away from the import screen.
- **FR-009a**: The same per-item categorization MUST also remain possible later through the existing transaction editor (covered by FR-006), so items not handled during import can still be fixed.
- **FR-010**: After an item is assigned a category, its net spend MUST be attributed to that category/subcategory in period summaries instead of 其他.
- **FR-011**: Spend for an item that remains uncategorized MUST continue to be represented in summary totals (under 其他) and MUST never be dropped.
- **FR-012**: Assigning categories MUST NOT change item amounts or the transaction's net total — only which category the spend is counted under.

### Key Entities *(include if feature involves data)*

- **Transaction**: A recorded expense with an amount, a date, and a set of tags. Tags may be plain store/context tags (e.g. `全家`) or category tags (`major:sub`). May own zero or more items.
- **Item**: A line belonging to a transaction, with a name, an optional amount, an optional note, and either its own category (`major:sub`) or none (in which case it inherits the transaction's category for display). May be created manually or auto-generated by invoice import.
- **Category**: An entry in the category catalog: a major and an optional subcategory, used both for the picker's options and for grouping spend in summaries.
- **Invoice line item**: A name + amount derived from an imported e-invoice, used to auto-generate transaction items; it carries no category.
- **Period category summary**: The breakdown of spend by category (and drill-down by subcategory) for a time period, including the 其他 bucket for spend with no category.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For any category in the catalog, a user can locate and select it for an item within the first screen of results after typing or after picking its major — without scrolling the full flat list.
- **SC-002**: A user can assign a category to an item in at most a few interactions (type-and-pick, or major-then-sub), measured as faster than scanning the previous flat list for the same target.
- **SC-003**: After importing an invoice that auto-generates items onto a transaction with no category tag, 100% of those items are visible and flagged as uncategorized in the import review, and each can be assigned a category inline there — without re-importing or leaving the import screen.
- **SC-004**: After the user assigns categories to previously-uncategorized invoice-generated items, those items' spend appears under the assigned categories in the period summary and no longer under 其他.
- **SC-005**: No spend ever disappears: the sum of all categories (including 其他) in a period equals the period's total net spend before and after categorizing items.

## Assumptions

- The existing category catalog (major + subcategory) is the source of truth; this feature does not add, rename, or restructure categories.
- The current "inherit transaction category" semantics for items without their own category tag are unchanged.
- The improved item category control follows the same major-then-subcategory + search pattern the app already uses for transaction-level category selection, applied at the item level for consistency.
- This feature changes only which category spend is attributed to; it does not change how amounts or net (discount-adjusted) amounts are computed.
- "Uncategorized" for statistics means an item has no `major:sub` category and no transaction-level category to inherit.
- Name-based category suggestion is **out of scope** for this feature (deferred per clarification 2026-06-09); the solution is deterministic UI only, with no auto-suggestion engine or LLM call.
- Surfacing and assigning categories for auto-generated items reuses the existing transaction/item editing flow (no separate re-import step is required).

## Dependencies

- Relies on the existing category catalog and the existing per-period category/subcategory summary behavior (including the 其他 fallback) established by prior features.
- Builds on the existing transaction-item model and item editing flow used for both manual entry and imported transactions.
