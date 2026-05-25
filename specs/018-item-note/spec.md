# Feature Specification: Item Note

**Feature Branch**: `018-item-note`
**Created**: 2026-05-25
**Status**: Draft
**Input**: User description: "Add a per-item note field to transaction items. Currently transaction_items has no note column — only name, amount, and tags. Users want to attach a short free-text note to individual items (e.g., "加辣", "禮物", "含運費") without polluting the item name or transaction-level note. Schema change: add nullable note column to transaction_items. PWA change: add a note input to ItemRow component. Backend: pass item note through POST /pwa/expense and the future PUT /pwa/transactions/:id edit endpoint."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Annotate an Item With a Short Note at Entry Time (Priority: P1)

A user records a meal expense with two items. One item has a special customisation ("加辣") or context ("生日禮物") that they want to remember but that doesn't belong in the item name. They tap a note field on that item row, type the note, and submit. The note is saved alongside the item.

**Why this priority**: Core value of the feature — without this, the note field doesn't exist at all.

**Independent Test**: Submit a transaction with one item that has a non-empty note. Verify the note is stored and retrievable. Delivers value immediately.

**Acceptance Scenarios**:

1. **Given** the expense entry form is open, **When** the user adds an item and fills in the item's note field, **Then** the note is submitted with the transaction and stored against that item.
2. **Given** an item with a note was saved, **When** the item is retrieved (e.g., via transaction history or the full view), **Then** the note field contains the value the user entered.
3. **Given** the expense entry form is open, **When** the user adds an item and leaves the note field empty, **Then** the item is saved normally with a null note — the note field is always optional.
4. **Given** a note longer than 200 characters is entered, **When** the user submits, **Then** the entry is rejected with a clear message indicating the note is too long.

---

### User Story 2 - Note Preserved Through Edit (Priority: P2)

When a user edits an existing transaction (once the edit feature ships), item notes that were previously saved are pre-filled in the edit form and can be changed or cleared.

**Why this priority**: Prevents data loss during edits; depends on the edit entry feature (019) being built.

**Independent Test**: After 019 ships — load an existing transaction with an item note in the edit form; verify the note is pre-filled; save; verify the updated note is stored.

**Acceptance Scenarios**:

1. **Given** a transaction with an item note exists, **When** the user opens it in the edit form, **Then** the item note field is pre-populated with the existing value.
2. **Given** the user clears an item's note in the edit form and saves, **Then** the note is stored as null (not the previous value).

---

### Edge Cases

- Item note is empty string: stored as NULL (trimmed on submission).
- Item note contains only whitespace: trimmed to NULL on submission.
- Multiple items on one transaction: each item independently has its own note (or none).
- Existing items (created before this feature): `note` is NULL; no migration needed.
- Note displayed in transaction history: shown as secondary text under the item name if non-null; hidden if null.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `transaction_items` table MUST gain a nullable `note` column (max 200 characters) via a schema migration. No backfill required — existing rows default to NULL.
- **FR-002**: The expense entry form MUST display an optional note input on each item row, labelled or placeholder-hinted clearly (e.g., "備註").
- **FR-003**: The note input MUST accept free text up to 200 characters. The UI MUST prevent or warn on input exceeding this limit.
- **FR-004**: The expense submission endpoint MUST accept an optional `note` field per item and store it. Empty string MUST be normalised to NULL before storage.
- **FR-005**: The item note MUST be returned when fetching transaction data (e.g., history list, full-view queries).
- **FR-006**: The edit form (feature 019) MUST pre-fill item notes from existing data and persist changes on save. *(Dependency: 019 not yet built — this requirement is a contract for 019 to honour.)*
- **FR-007**: The note field is entirely optional at all times — absence of a note MUST never block entry or edit submission.

### Key Entities

- **`transaction_items.note`**: Nullable text, max 200 chars. Free-form annotation attached to one item. Independent per item; no relationship to transaction-level `note`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A transaction submitted with an item note is retrievable with that note intact — 100% round-trip fidelity.
- **SC-002**: A transaction submitted without an item note saves and retrieves correctly with a null note — no regression to existing entry flow.
- **SC-003**: An item note exceeding 200 characters is rejected before storage — 0 oversized notes in the database.
- **SC-004**: All existing transaction items (created before this feature) continue to function normally with a null note — 0 regressions on historical data.

## Assumptions

- Note is display-only metadata — it does not affect `effective_amount`, category aggregation, or any computation.
- 200-character limit is sufficient for typical annotations; no multi-line or rich-text support needed.
- No search or filter by item note in scope for this feature.
- Feature 019 (edit entry) is a dependency for US2; US1 delivers standalone value without it.
- No Discord bot changes needed — the bot's entry flow does not use item-level notes.
