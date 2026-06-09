# Feature Specification: Usable item-level category assignment

**Feature Branch**: `026-item-category-tagging`
**Created**: 2026-06-09
**Status**: Draft
**Input**: User description: "(1) The per-item category picker shown beside each item is hard to use — it lists every category value flat, ungrouped by major, with no search. Example: bought a popsicle and a pudding at FamilyMart, tagged the transaction only with the plain store tag `全家`; when adding items there was no fast way to pick each item's category. It needs search (with type-ahead) and/or filter by major category. (2) Edge case: bought four differently-categorized things at FamilyMart, again tagged only `全家`, didn't write items, and let month-end invoice import auto-match and auto-generate the items. Those auto-generated items carry no `major:sub` category, so in category statistics their spend disappears into 其他 / uncategorized."

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

The user buys several differently-categorized things at one store, tags the transaction only with a plain store tag (e.g. `全家`), and deliberately skips writing items. At month-end they import the e-invoice; because amount and date are well-calibrated, the import auto-matches the transaction and auto-generates one item per invoice line. Those generated items carry no `major:sub` category and the transaction has no category tag to inherit, so in category statistics all of that spend collapses into 其他 / uncategorized instead of the real categories. The user needs to notice these uncategorized items and assign each a category after the fact, so the spend lands in the correct category — without re-importing or re-creating the transaction.

**Why this priority**: This is a correctness problem (real spend is mis-attributed to 其他), but it builds on Story 1's picker to be usable, so it follows it. It is independently valuable: even alone it stops invoice-derived spend from silently disappearing from category breakdowns.

**Independent Test**: Import an invoice that auto-matches a transaction tagged only `全家` with no items, producing several auto-generated items. Confirm those items are identifiable as uncategorized, assign each a category, and confirm the category summary moves their spend out of 其他 into the assigned categories.

**Acceptance Scenarios**:

1. **Given** an invoice import auto-generated items for a transaction whose tags contain no category, **When** the user reviews that transaction, **Then** the items are visibly flagged as needing a category.
2. **Given** such uncategorized items exist, **When** the user opens the transaction's item editor, **Then** they can assign a category to each item using the Story 1 picker and save without re-importing.
3. **Given** an uncategorized auto-generated item, **When** the user assigns it a category and the period summary is viewed, **Then** that item's spend is counted under the assigned category/subcategory and no longer under 其他.
4. **Given** an auto-generated item the user has not yet categorized, **When** the period summary is viewed, **Then** its spend is still represented (under 其他) and never dropped from totals.
5. **Given** the user assigns different categories to several items of the same transaction, **When** the summary is viewed, **Then** each item's net spend is attributed to its own assigned category.

---

### User Story 3 - Suggest a category from the item's name (Priority: P3, optional)

To reduce the manual tagging the user is trying to avoid (they import invoices precisely because they're "too lazy to write items"), when an item is created or edited the system offers a suggested category based on the item's name and the user's previously categorized items with the same name. The user can accept, change, or ignore the suggestion.

**Why this priority**: This is a convenience enhancement layered on Stories 1 and 2, not required for the MVP. It is explicitly optional and may be deferred or dropped; the core value is delivered without it.

**Independent Test**: Create or import an item whose name exactly matches a previously categorized item, and confirm the system pre-fills or offers that category as a non-binding suggestion that the user can override.

**Acceptance Scenarios**:

1. **Given** a previously saved item named "布丁" categorized as `飲食:零食`, **When** a new item named "布丁" is created or imported, **Then** the system suggests `飲食:零食` without overwriting any choice the user makes.
2. **Given** an item whose name matches nothing in the user's history, **When** it is created, **Then** no category is forced and the user categorizes it manually via Story 1.

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
- **FR-008**: When reviewing a transaction, the user MUST be able to see which of its items are uncategorized (including items created by invoice auto-fill).
- **FR-009**: The user MUST be able to assign a category to an auto-generated item after import, editing the existing transaction without re-importing or re-creating it.
- **FR-010**: After an item is assigned a category, its net spend MUST be attributed to that category/subcategory in period summaries instead of 其他.
- **FR-011**: Spend for an item that remains uncategorized MUST continue to be represented in summary totals (under 其他) and MUST never be dropped.
- **FR-012**: Assigning categories MUST NOT change item amounts or the transaction's net total — only which category the spend is counted under.

**Category suggestion (Story 3, optional)**

- **FR-013**: When an item is created or edited, the system MAY suggest a category derived from the item's name and previously categorized items of the same name.
- **FR-014**: Any suggestion MUST be non-binding — the user can accept, change, or ignore it, and it MUST NOT overwrite a category the user has already chosen.

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
- **SC-003**: After importing an invoice that auto-generates items onto a transaction with no category tag, 100% of those items are identifiable as uncategorized and can be assigned a real category.
- **SC-004**: After the user assigns categories to previously-uncategorized invoice-generated items, those items' spend appears under the assigned categories in the period summary and no longer under 其他.
- **SC-005**: No spend ever disappears: the sum of all categories (including 其他) in a period equals the period's total net spend before and after categorizing items.
- **SC-006** (Story 3, if built): For items whose name exactly matches a previously categorized item, the system suggests the correct category in the large majority of cases, and never blocks or overrides the user's own choice.

## Assumptions

- The existing category catalog (major + subcategory) is the source of truth; this feature does not add, rename, or restructure categories.
- The current "inherit transaction category" semantics for items without their own category tag are unchanged.
- The improved item category control follows the same major-then-subcategory + search pattern the app already uses for transaction-level category selection, applied at the item level for consistency.
- This feature changes only which category spend is attributed to; it does not change how amounts or net (discount-adjusted) amounts are computed.
- "Uncategorized" for statistics means an item has no `major:sub` category and no transaction-level category to inherit.
- Story 3 (name-based suggestion) is optional and may be deferred or dropped without affecting the value of Stories 1 and 2. Whether it is in scope is confirmed during planning/clarification.
- Surfacing and assigning categories for auto-generated items reuses the existing transaction/item editing flow (no separate re-import step is required).

## Dependencies

- Relies on the existing category catalog and the existing per-period category/subcategory summary behavior (including the 其他 fallback) established by prior features.
- Builds on the existing transaction-item model and item editing flow used for both manual entry and imported transactions.
