# Feature Specification: Android Expense Prompt

**Feature Branch**: `001-expense-tracker`
**Created**: 2026-05-06
**Status**: Draft
**Input**: "I also want a prompt window in android app, exact the same function as discord bot, in case discord is dead or buried"

---

## User Scenarios & Testing

### User Story 1 — Manual Expense Entry from Android (Priority: P1)

The user opens the Android app, sees a single text input field, types a freeform expense description (e.g. `150 燙青菜 牛肉麵` or `500 悠遊卡 捷運月票`), and submits it. The app sends the input to the backend for NLP parsing, stores the expense, and displays a confirmation with the current month's total spending and remaining budget — exactly the same outcome as typing the same message in Discord.

**Why this priority**: This is the entire feature. When Discord is unavailable or inaccessible, this prompt is the only manual input path. Without it, cash and EasyCard expenses cannot be recorded.

**Independent Test**: Open the app, submit a freeform expense, verify the expense is stored in the database with correct amount and items, and a budget summary is displayed in-app — with no Discord involved.

**Acceptance Scenarios**:

1. **Given** the user types `250 星巴克 拿鐵` and submits, **When** the backend processes the input, **Then** an expense record for NT$250 is created with item "星巴克 拿鐵", and the app displays the current month's total and remaining budget.
2. **Given** the user submits `80 悠遊卡 捷運`, **When** processed, **Then** the record is stored with payment method `easy_card` and the confirmation is shown in-app.
3. **Given** the user submits an input with no parseable amount (e.g. `吃了個東西`), **When** processed, **Then** the app displays an error message explaining the input could not be understood, and no record is stored.
4. **Given** the device has no internet connection when the user submits, **When** connectivity is restored, **Then** the expense is submitted automatically and the user sees a deferred confirmation notification.
5. **Given** the user submits successfully, **When** the confirmation appears, **Then** the text field is cleared and ready for a new entry.

---

### Edge Cases

- What happens when the backend returns a parse error? The app shows a human-readable error message; the text is preserved so the user can correct and resubmit.
- What if the user submits an empty string? Submission is blocked; a hint message is shown.
- What if the same expense is submitted twice (double-tap)? The second submission goes through normal dedup — same amount within 3 minutes merges into one record at the backend.
- What if the device is offline and the user closes the app before syncing? The queued entry persists and is submitted on next launch with connectivity.

---

## Requirements

### Functional Requirements

- **FR-001**: The Android app MUST provide a dedicated input screen with a text field accepting freeform expense descriptions in the same format as the chat interface (amount followed by description, e.g. `150 燙青菜`).
- **FR-002**: On submission, the app MUST send the text to the backend for NLP parsing — applying the same parsing logic used for chat-based input.
- **FR-003**: After a successful submission, the app MUST display a confirmation screen showing the parsed amount, items, and current month's spending summary (total spent and remaining budget).
- **FR-004**: If the backend cannot parse a valid expense from the input, the app MUST display a clear error message and preserve the original text for correction.
- **FR-005**: If the device is offline at submission time, the entry MUST be queued locally and submitted automatically once connectivity is restored, with the user notified of the deferred outcome.
- **FR-006**: The text field MUST be cleared after a successful submission and focused for the next entry.
- **FR-007**: The prompt screen MUST be accessible directly — without navigating through multiple screens — so it can serve as a fast fallback input method.

### Key Entities

No new entities. Uses the same **Transaction** entity as the main expense tracker. The prompt is a new input surface, not a new data concept.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: From opening the prompt screen to a submitted expense being stored, the end-to-end flow completes in under 10 seconds on a normal connection.
- **SC-002**: 100% of expense types supported by the chat interface (cash, EasyCard, bank account, manual credit card) can also be submitted via the Android prompt — no category is blocked.
- **SC-003**: Offline-queued expenses are submitted within 30 seconds of connectivity being restored, with no data loss.
- **SC-004**: Parse errors are surfaced to the user within 5 seconds of submission with a message clear enough that the user can correct and resubmit without assistance.

---

## Assumptions

- The Android prompt uses the same backend NLP endpoint as the chat interface; no new server-side logic is needed beyond what already exists.
- The prompt is a lightweight addition to the existing Android app — a new screen, not a separate app.
- The prompt does not post to the Discord channel when used (it is a standalone fallback, not a mirror). Budget summaries are shown in-app only.
- Payment method defaults to `cash` when no payment keyword is detected in the input, matching the chat interface behaviour for manual entries.
- No history or transaction list is shown in the app — just the input prompt and the immediate confirmation. Reviewing past expenses is done via Discord or directly in the database.
- The feature is scoped to single freeform text input; structured forms (dropdowns, pickers) are out of scope.
