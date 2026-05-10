# Feature Specification: Explicit Payment Method Option for /expense

**Feature Branch**: `006-expense-payment-option`  
**Created**: 2026-05-10  
**Status**: Draft  
**Input**: User description: "explicitly separate payment_method from description for /expense, only those 5 predefined value acceptable (現金、信用卡、悠遊卡、銀行、行動支付)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Record Expense with Explicit Payment Method (Priority: P1)

A user records an expense by selecting their payment method from a dropdown list, rather than typing it as part of the description text. The description field is now free to contain only what was purchased — tags, items, notes — without needing to embed payment keywords.

**Why this priority**: This is the entire scope of the feature. Selecting from a fixed list of payment methods removes ambiguity, prevents typos, and guarantees the stored value is always one of the five valid options. It also makes the description field cleaner — users no longer need to know the exact keyword format for each payment method.

**Independent Test**: Issue `/expense amount:300 description:#食:午餐, 麥當勞 大麥克套餐 250 payment_method:信用卡` and verify the stored `payment_method` is `credit_card`, the response confirmation shows `信用卡`, and the description is parsed purely for tags/items/notes without payment keyword interference.

**Acceptance Scenarios**:

1. **Given** the user runs `/expense` with `payment_method:信用卡`, **When** the transaction is saved, **Then** `payment_method` is stored as `credit_card` and the confirmation shows `[信用卡]`.
2. **Given** the user runs `/expense` without providing `payment_method`, **When** the transaction is saved, **Then** `payment_method` defaults to `現金` (cash) and the confirmation shows `[現金]`.
3. **Given** the description contains the text "信用卡" as a plain word (not a Discord option), **When** the transaction is parsed, **Then** "信用卡" is treated as a note fragment — not extracted as a payment method.
4. **Given** the user selects `payment_method:悠遊卡`, **When** the transaction is saved, **Then** `payment_method` is stored as `easy_card`.
5. **Given** the user selects `payment_method:行動支付`, **When** the transaction is saved, **Then** `payment_method` is stored as `prepaid_wallet`.
6. **Given** the user selects `payment_method:銀行轉帳`, **When** the transaction is saved, **Then** `payment_method` is stored as `bank_account`.

---

### Edge Cases

- What if the user includes a payment keyword (e.g., "現金") inside the description? → Treated as plain text (note fragment); the Discord option is authoritative.
- What if `payment_method` is omitted entirely? → Defaults to `現金` (cash).
- What if the description has no recognisable content beyond tags? → Description remains optional context; the transaction is recorded with whatever is provided.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `/expense` Discord command MUST include a `payment_method` option with exactly 5 predefined choices: 現金、信用卡、悠遊卡、銀行轉帳、行動支付.
- **FR-002**: The `payment_method` option MUST be optional; when omitted, the transaction MUST be stored with `payment_method = cash` (現金).
- **FR-003**: The `parseDescription()` function MUST NOT classify any token as a payment method — payment keyword matching is removed from the description parser entirely.
- **FR-004**: The transaction stored in the database MUST reflect the value supplied via the `payment_method` Discord option, not any keyword found in the description.
- **FR-005**: The expense confirmation message MUST display the selected payment method label in Traditional Chinese (e.g., `[信用卡]`).
- **FR-006**: The updated `/expense` command definition MUST be re-registered with Discord so the dropdown appears in the slash command UI.

### Key Entities

- **Payment Method**: One of five values — 現金 (cash), 信用卡 (credit_card), 悠遊卡 (easy_card), 銀行轉帳 (bank_account), 行動支付 (prepaid_wallet). Stored as the internal enum value; displayed as the Chinese label.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can record an expense and select their payment method in a single `/expense` command invocation using the Discord autocomplete dropdown — no free-text keyword required.
- **SC-002**: 100% of expense transactions recorded via Discord have a `payment_method` value that is exactly one of the five valid enum values, with no parse failures or fallback to a default due to keyword ambiguity.
- **SC-003**: Descriptions that previously required a payment keyword (e.g., "信用卡, #食:午餐, 麥當勞 100") continue to work correctly when the keyword is moved to the explicit option, and the description parses identically when the keyword is absent.
- **SC-004**: The `/expense` command in Discord presents a dropdown for `payment_method` with exactly 5 labelled choices after re-registration.

## Assumptions

- The five payment method choices map to existing enum values in the system; no new enum values are introduced.
- `payment_method` remains optional with a `cash` default to preserve backwards compatibility (existing integrations that don't supply it will continue to work).
- The Android expense notification path (`parseRawExpenseText` via Gemini) is out of scope — it is unchanged by this feature.
- The description field retains its existing format (comma-delimited tags, items, notes); only payment keyword classification is removed from parsing.
- Discord command re-registration is a manual step executed after deployment; no automated registration pipeline exists.
