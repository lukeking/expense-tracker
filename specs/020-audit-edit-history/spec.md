# Feature Specification: Audit Transaction Editing

**Feature Branch**: `020-audit-edit-history`  
**Created**: 2026-05-30  
**Status**: Draft  

## User Scenarios & Testing *(mandatory)*

### User Story 1 — View Edit History for a Transaction (Priority: P1)

A user who has previously edited an expense transaction wants to see what the transaction looked like before the edit, so they can verify the change or recover the original values if the edit was a mistake.

**Why this priority**: Core safety net — without history visibility, the edit history data is stored but inaccessible, defeating the feature's purpose.

**Independent Test**: Open the edit sheet for any previously-edited expense. A history section is visible at the bottom showing at least one past revision with a timestamp and what changed. Delivers full recovery value on its own.

**Acceptance Scenarios**:

1. **Given** an expense transaction has been edited at least once, **When** the user opens the edit sheet for that transaction, **Then** a history section at the bottom shows each past revision with its timestamp.
2. **Given** a history entry is collapsed, **When** the user expands it, **Then** the before/after values of every changed field are displayed (header fields and items/adjustments sets).
3. **Given** a transaction has never been edited, **When** the user opens the edit sheet, **Then** the history section is absent or shows an empty state.

---

### User Story 2 — History Captured on Save (Priority: P1)

When a user saves an edited transaction, the system automatically records a history entry capturing the exact state before the change, so no manual action is required to preserve the audit trail.

**Why this priority**: Without reliable capture, the history UI is empty and the feature provides no value.

**Independent Test**: Edit a transaction (change amount, items, or adjustments), save it, then re-open the edit sheet. The history section shows one entry matching the timestamp of the save, with correct before/after diffs.

**Acceptance Scenarios**:

1. **Given** a user edits an expense transaction and saves, **When** the save completes successfully, **Then** a new history entry is appended recording what the transaction looked like before the save.
2. **Given** a user opens the edit sheet but saves with no changes (identical data), **When** the save completes, **Then** no history entry is created (no-op edit is not recorded).
3. **Given** a save fails (network error or validation error), **When** the error is returned, **Then** no history entry is written.

---

### User Story 3 — History Is Immutable (Priority: P2)

A user can trust that history entries can never be overwritten or deleted, either by the application or by a future edit, so the audit trail is a reliable record.

**Why this priority**: Immutability is the trust foundation; without it history entries could be lost, undermining the recovery use case.

**Independent Test**: Edit the same transaction three times. Re-open edit sheet. History shows three entries, each preserving its original snapshot, oldest first.

**Acceptance Scenarios**:

1. **Given** a transaction has been edited multiple times, **When** the user views the history section, **Then** all prior revisions are shown in chronological order, oldest first.
2. **Given** a transaction is edited again, **When** the new save completes, **Then** all previous history entries remain unchanged and a new entry is appended.

---

### Edge Cases

- What happens when a transaction has a very large items list — does the diff remain readable?
- How is the history section rendered when there are 20+ history entries?
- What if the `note` field transitions between null and empty string — is this treated as a change?
- What if two sessions edit the same transaction concurrently — are both history entries preserved?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST record a history entry every time a transaction edit is saved successfully, capturing the full state of the transaction immediately before the save.
- **FR-002**: Each history entry MUST store: the timestamp of the edit, and a structured diff containing the before and after values of every field that changed, covering the transaction header (paid amount, note, category tag, payment method) and the complete items and adjustments sets.
- **FR-003**: A history entry MUST NOT be created when the submitted edit produces no change to the stored data.
- **FR-004**: History entries MUST be append-only; no entry may be modified or deleted by the application.
- **FR-005**: The edit sheet MUST display a history section below the form when at least one history entry exists for the transaction.
- **FR-006**: Each history entry in the UI MUST show its timestamp and be expandable to reveal the full before/after diff.
- **FR-007**: The history section MUST be collapsible so it does not obscure the edit form when the user is actively editing.
- **FR-008**: Only expense-type transactions have an edit sheet; accordingly only expense-type transactions will ever have history entries.
- **FR-009**: History data MUST be returned as part of the GET endpoint that fetches a transaction for editing, so a single request loads both the editable state and the history.

### Key Entities

- **EditHistoryEntry**: Represents one revision snapshot. Key attributes: transaction identifier, timestamp of the edit, diff payload (structured before/after for changed header fields, before/after for items array, before/after for adjustments array).
- **Diff payload**: A record of only the fields that changed. Header diffs are field-by-field; items and adjustments diffs are full array snapshots (before array, after array) because ordering and identity both matter.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After saving an edit, the history entry is visible in the edit sheet within the same reload that fetches the updated transaction — no additional user action required.
- **SC-002**: All prior history entries are present and unmodified after any number of subsequent edits to the same transaction.
- **SC-003**: A no-op save (no fields changed) produces zero new history entries.
- **SC-004**: The history section does not appear for transactions that have never been edited.
- **SC-005**: History load adds no perceptible delay to opening the edit sheet (history is returned in the same response as the transaction detail).

## Assumptions

- The edit flow targets expense-type transactions only (established in feature 019); history is therefore also expense-only.
- Only one actor (the app user) edits transactions; no multi-user attribution is required. The history entry does not need a `user_id` field in v1.
- History entries are never surfaced outside the edit sheet (no standalone history screen, no summary view integration) in v1.
- The before-state is captured app-side by reading the transaction before the PUT rather than via a database trigger.
- Items and adjustments diffs are stored as full array snapshots (not line-level diffs), keeping the diff format simple to read and reconstruct.
- There is no history pruning or retention limit; all entries are kept indefinitely.
- The `note` field treats null and empty string as equivalent (same normalisation as the entry form); a change between them is not recorded as a diff.
