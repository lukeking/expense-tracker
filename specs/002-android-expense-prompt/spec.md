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
4. **Given** the user submits successfully, **When** the confirmation appears, **Then** the text field is cleared and ready for a new entry.

---

### User Story 2 — Foreign Transaction Fee Logging (Priority: P2)

When making a foreign purchase, the user's credit card later charges a separate service fee (國外交易服務費, typically 1–1.5%) that does not appear in the original push notification — it only shows up on the monthly statement days later. The user needs to record this fee linked to the original transaction without editing the original amount.

Using the Android prompt, the user types `fee [amount] [original transaction description]` (e.g. `fee 47 星巴克`). The backend finds the most recent matching transaction, creates a new linked fee record for NT$47, and confirms in-app. The original transaction record remains unchanged.

**Why this priority**: Without this, foreign fees either go unrecorded (inaccurate budget) or require re-entering the full transaction with a wrong date (loses time and causal accuracy). P2 because it only affects foreign card transactions.

**Independent Test**: Create a transaction for NT$380 "星巴克", then submit `fee 47 星巴克` via the prompt; verify a new NT$47 fee transaction exists linked to the original NT$380 record, and the original record is unmodified.

**Acceptance Scenarios**:

1. **Given** a prior transaction for NT$1,200 "Airbnb" exists, **When** the user submits `fee 180 Airbnb`, **Then** a new fee transaction of NT$180 is created linked to the Airbnb transaction, and the app confirms with updated budget totals.
2. **Given** no matching transaction is found for the description, **When** the user submits `fee 47 某商店`, **Then** the app shows a "no matching transaction found" message and no fee record is created.
3. **Given** multiple transactions match the description (e.g. two 星巴克 visits), **When** the user submits `fee 47 星巴克`, **Then** the app lists the candidates with dates/amounts and a "None of these" option; selecting a candidate links the fee record, selecting "None of these" saves it as a standalone unlinked transaction.
4. **Given** the user submits `fee 180` with no description, **When** the app displays the candidate list, **Then** it shows the 20 most recent transactions (most recent first) plus the "None of these" option, so the user can tap without recalling any details.

---

### Edge Cases

- What happens when the backend returns a parse error? The app shows a human-readable error message; the text is preserved so the user can correct and resubmit.
- What if the user submits an empty string? Submission is blocked; a hint message is shown.
- What if the same expense is submitted twice (double-tap)? The second submission goes through normal dedup — same amount within 3 minutes merges into one record at the backend.
- What if the device is offline when the user submits? The app shows an error and preserves the input for the user to retry manually.
- What if `fee` is submitted without a description and multiple recent foreign transactions exist? The app presents the last 5 transactions as candidates for the user to select.

---

## Requirements

### Functional Requirements

- **FR-001**: The Android app MUST provide a dedicated input screen with a text field accepting freeform expense descriptions in the same format as the chat interface (amount followed by description, e.g. `150 燙青菜`).
- **FR-002**: On submission, the app MUST send the text to the backend for NLP parsing — applying the same parsing logic used for chat-based input.
- **FR-003**: After a successful submission, the app MUST display a confirmation screen showing the parsed amount, items, and current month's spending summary (total spent and remaining budget).
- **FR-004**: If the backend cannot parse a valid expense from the input, the app MUST display a clear error message and preserve the original text for correction.
- **FR-005**: If the device is offline at submission time, the app MUST show a clear error and preserve the input text so the user can retry when connectivity is restored. No automatic queuing or background submission is required.
- **FR-006**: The text field MUST be cleared after a successful submission and focused for the next entry.
- **FR-007**: The prompt screen MUST be accessible directly — without navigating through multiple screens — so it can serve as a fast fallback input method.
- **FR-008**: The app MUST support recording a foreign transaction fee linked to a prior transaction. The user enters an amount and optional parent description. The app presents a scrollable list of candidate transactions (most recent first) for the user to tap-select. If no candidates match the description, the app shows a "not found" message with a "Retype" button and a "Save without link" button — tapping Retype opens an editable field pre-filled with the previous search term so the user can correct it and search again. The list MUST include a "None of these / record without link" option when candidates are shown.
- **FR-009**: The app MUST support recording a refund or reimbursement linked to a prior transaction. Partial refunds are allowed. The candidate selection UI, retype mechanism, and "None of these" escape hatch from FR-008 apply equally. Business reimbursements (出公差墊付請領) and ticket cancellations (退票) both use this flow.

### Key Entities

No new entities. Uses the same **Transaction** entity as the main expense tracker, including the `parent_transaction_id` field for linked fee records. The prompt is a new input surface, not a new data concept.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: From opening the prompt screen to a submitted expense being stored, the end-to-end flow completes in under 10 seconds on a normal connection.
- **SC-002**: 100% of expense types supported by the chat interface (cash, EasyCard, bank account, manual credit card) can also be submitted via the Android prompt — no category is blocked.
- **SC-003**: When submission fails due to no connectivity, the error is shown within 3 seconds and the input text is preserved intact for immediate retry.
- **SC-004**: Parse errors are surfaced to the user within 5 seconds of submission with a message clear enough that the user can correct and resubmit without assistance.
- **SC-005**: A `fee` command with an unambiguous description match completes (linked record created + confirmation shown) in under 10 seconds.

---

## Clarifications

### Session 2026-05-09

- Q: What is the Android app scope beyond the basic expense prompt — specifically, offline queue, fee/refund candidate UI, and retype mechanism? → A: No offline queue (background sync adds complexity without proportional value). Fee and refund commands use the same candidate-list UX as Discord (manual parent input → show candidates → retype if not found). Retype modal is required: when no match is found, show a "not found" prompt with a Retype button pre-filled with the prior search term and a "Save without link" button.

### Session 2026-05-06

- Q: How should refunds (退款/退票/請領) be modeled? → A: `transaction_type` field (`expense`|`refund`|`fee`) on all transactions. Refunds are positive-amount child transactions linked via `parent_transaction_id`. Budget = Σ(expense) + Σ(fee) − Σ(refund). Same `refund` command for business reimbursements and ticket cancellations; cancellation fees use the `fee` command.
- Q: Where should the foreign transaction fee command live? → A: Both Discord and Android prompt. Fee is modeled as a new linked transaction (not an edit to the original) — `fee [amount] [description]` finds the matching parent transaction and creates a child fee record via `parent_transaction_id`. No web console or history UI needed.

---

## Assumptions

- The Android prompt uses the same backend NLP endpoint as the chat interface; no new server-side logic is needed beyond what already exists.
- The prompt is a lightweight addition to the existing Android app — a new screen, not a separate app.
- The prompt does not post to the Discord channel when used (it is a standalone fallback, not a mirror). Budget summaries are shown in-app only.
- Payment method defaults to `cash` when no payment keyword is detected in the input, matching the chat interface behaviour for manual entries.
- No history or transaction list is shown in the app — just the input prompt and the immediate confirmation. Reviewing past expenses is done via Discord or directly in the database.
- The feature is scoped to single freeform text input; structured forms (dropdowns, pickers) are out of scope.
