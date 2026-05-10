# Feature Specification: Auto-Create Item from Subcategory

**Feature Branch**: `007-fix-item-note-clarity`  
**Created**: 2026-05-10  
**Status**: Draft  
**Input**: User description: "When #category:subcategory tag is present but no items are parsed, auto-create a single item using the subcategory name and total amount"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Categorized Expense Without Redundant Item Entry (Priority: P1)

A user records a categorized expense and expects the subcategory label to serve as the item name automatically, without typing it twice in the description.

For example: `/expense amount:300 description:#food:餐飲` should store one item `{ name: "餐飲", amount: 300 }` in addition to the tag `food:餐飲`, with no manual item token required.

**Why this priority**: The current behavior requires redundant input — the user must type both `#food:餐飲` and `餐飲 300` if they want an item record. This is the core friction the feature removes.

**Independent Test**: Can be fully tested by submitting a `/expense` command with only a `#category:subcategory` description (no item tokens) and verifying the `items` array in the database contains exactly one entry with the subcategory name and total amount.

**Acceptance Scenarios**:

1. **Given** a user types `/expense amount:300 description:#food:餐飲` with no item tokens, **When** the command is processed, **Then** the transaction is saved with `items=[{name:"餐飲", amount:300}]` and `tags=["food:餐飲"]`.

2. **Given** a user types `/expense amount:180 description:#food:餐飲, 牛肉麵 120, 飲料 60` with explicit item tokens, **When** the command is processed, **Then** the explicit items are stored as-is and no auto-creation occurs.

3. **Given** a user types `/expense amount:100 description:#lunch` with a plain tag (no subcategory colon), **When** the command is processed, **Then** no item is auto-created (plain tags do not trigger auto-creation).

4. **Given** a user types `/expense amount:200 description:#food:餐飲, 早餐` with a category tag and free-text note but no item tokens, **When** the command is processed, **Then** an item `{name:"餐飲", amount:200}` is auto-created.

---

### Edge Cases

- What happens when a plain `#tag` (no colon) is the only description token? → No auto-creation; plain tags do not carry a subcategory name.
- What happens when multiple category tags are present (`#food:餐飲, #work:午餐`) and no items are typed? → Auto-create from the first (accepted) subcategory; second tag is already ignored per existing warning behavior.
- What happens when no description is provided at all? → No auto-creation; items remain empty as before.
- What happens when both auto-creation conditions are met and explicit items are also present? → Explicit items take precedence; auto-creation does not apply.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When the parsed description contains zero item tokens AND at least one `#category:subcategory` tag, the system MUST auto-create a single item with `name = subcategoryName` and `amount = totalExpenseAmount`.
- **FR-002**: The auto-created item MUST be stored in the `items` array in the database, identical in structure to manually entered items.
- **FR-003**: If one or more explicit item tokens are parsed from the description, auto-creation MUST NOT apply — the user's explicit items are stored as-is.
- **FR-004**: A plain tag (`#tag` without a colon) MUST NOT trigger auto-creation, even when no items are present.
- **FR-005**: The confirmation message shown to the user MUST include the auto-created item line, consistent with how explicit items are displayed.
- **FR-006**: When multiple `#category:subcategory` tags are present (second+ already warned and ignored), auto-creation MUST use only the first accepted subcategory name.

### Key Entities

- **Item**: `{ name: string, amount: number }` — stored in the `items` JSONB column of the `transactions` table.
- **Category tag**: A description token matching `#word:word` format; the part after the colon is the subcategory name used for auto-creation.
- **Plain tag**: A description token matching `#word` (no colon); does not trigger auto-creation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A `/expense` command with only a `#category:subcategory` description and no item tokens always produces a non-empty `items` array in the database.
- **SC-002**: The auto-created item's `name` exactly matches the subcategory portion of the tag (text after the colon), and its `amount` equals the total expense amount.
- **SC-003**: Existing behavior for explicit items is completely unchanged — no regression when item tokens are present.
- **SC-004**: Plain tags (no colon) never produce auto-created items.

## Assumptions

- This feature applies only to the Discord `/expense` command entry point; the Android API path and CSV import are unaffected.
- The subcategory name used for auto-creation is the raw string after the colon in the tag (e.g., `food:餐飲` → `餐飲`), with no additional transformation.
- If no description is provided, items remain empty — auto-creation requires at least one `#category:subcategory` token.
- The item-total-vs-amount mismatch warning does not fire for auto-created items, since `item.amount === totalAmount` by definition.
