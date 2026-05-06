# Feature Specification: Automated Personal Expense Tracker

**Feature Branch**: `001-expense-tracker`
**Created**: 2026-05-06
**Status**: Clarified (sessions 2026-05-05, 2026-05-06)
**Input**: `proposal.md` — 自動化記帳系統架構提案 (Discord Bot + Android 監聽)

---

## User Scenarios & Testing

### User Story 1 — Manual Expense Logging via Chat (Priority: P1)

The user types a freeform message in a designated chat channel describing a cash or EasyCard expense (e.g., `150 燙青菜 牛肉麵` or `80 悠遊卡 捷運`). The system interprets the message using natural language understanding, extracts the amount and item descriptions, stores the record, and immediately replies with the current month's total spending and remaining budget.

**Why this priority**: Establishes the foundational record-keeping loop without requiring any device setup. Works from day one and covers all payment types the user enters manually (cash, EasyCard, bank transfers). This is the minimum viable product.

**Independent Test**: Send a freeform chat message with amount and description; verify a structured expense record is created and a budget-status reply is returned — no other system components required.

**Acceptance Scenarios**:

1. **Given** the user types `250 星巴克 咖啡` in the chat, **When** the message is received, **Then** a record is stored for NT$250, the item is parsed as "星巴克 咖啡", and the bot replies with updated monthly totals.
2. **Given** the user types `80 悠遊卡 捷運`, **When** the message is received, **Then** the record is stored with payment method `easy_card` and no automated follow-up is attempted.
3. **Given** the user types an ambiguous message with no parseable amount, **When** the message is received, **Then** the bot replies asking for clarification without storing a partial record.
4. **Given** the monthly budget is set to NT$15,000 and NT$14,500 has already been spent, **When** a new expense of NT$600 is logged, **Then** the bot's reply includes an over-budget warning.

---

### User Story 2 — Automatic Credit Card / Mobile Wallet Expense Capture (Priority: P2)

When the user makes a purchase with a credit card (directly or via a mobile payment app such as LINE Pay or Google Pay), the phone receives a bank push notification. The system automatically intercepts that notification, parses the amount and payment details, and records the expense — without any manual action from the user. If the same purchase triggers notifications from multiple apps within a short window, all notifications are merged into a single expense record.

**Why this priority**: This covers ~95% of real spending. Once working, the user almost never needs to log expenses manually for card payments.

**Independent Test**: Trigger a credit card purchase; verify the expense is recorded automatically in the system and reflected in the budget without any user interaction.

**Acceptance Scenarios**:

1. **Given** a credit card purchase of NT$380 at 全家, **When** the bank sends a push notification, **Then** a record for NT$380 is created automatically and the user receives a budget-status message in chat.
2. **Given** the same NT$380 purchase triggers both a bank notification and a LINE Pay notification within 3 minutes, **When** both notifications are received, **Then** only one expense record is created (bank name from the bank notification, wallet type from the LINE Pay notification, merged into one record).
3. **Given** a push notification for an EasyCard auto top-up of NT$500, **When** the notification is received, **Then** the system ignores it and no expense record is created.
4. **Given** a push notification for an ATM cash withdrawal of NT$3,000, **When** the notification is received, **Then** the system ignores it and no expense record is created.
5. **Given** a LINE Pay payment from stored credit (prepaid wallet balance), **When** the notification is received, **Then** the record is stored with payment method `prepaid_wallet` and wallet `line_pay`.

---

### User Story 3 — Automatic Receipt Reconciliation (Priority: P3)

Each night, the system fetches the user's e-invoice records from the government invoice platform using a mobile barcode. For each automatically-captured card expense from the same day, the system attempts to match the invoice to the expense by amount and time proximity. When a match is found, the expense record is enriched with full item-level details and the chat message for that expense is updated to show the itemised breakdown.

**Why this priority**: Adds item-level detail to what would otherwise be amount-only records. Enhances searchability and budget analysis. Depends on User Story 2 being operational.

**Independent Test**: Manually insert an expense record with a known amount and timestamp; trigger a reconciliation run; verify the record is updated with item details from the matching invoice.

**Acceptance Scenarios**:

1. **Given** an expense of NT$380 was recorded automatically today, **When** the nightly reconciliation runs, **Then** the system finds the matching invoice, updates the record with item details, and edits the original chat message to show the breakdown.
2. **Given** two unmatched expenses share the same amount (NT$250) in the same day, **When** the matching invoice arrives, **Then** the system does not auto-match; it sends an ambiguous-match alert in chat listing both candidates and waits for the user to confirm which one is correct.
3. **Given** no invoice is found for an expense within 3 days, **When** the reconciliation runs, **Then** the record remains unmatched and no error is raised; it can still be matched later.

---

### User Story 4 — Monthly Budget Tracking and Spending Overview (Priority: P4)

The user can query the current month's spending summary at any time from chat, and the system automatically includes a budget-status update with every expense notification. The user can configure a monthly total budget target.

**Why this priority**: Closes the feedback loop — knowing the budget impact of each purchase is the core motivation for logging in the first place. However this is passive/read-only and can be added on top of the logging foundation.

**Independent Test**: Set a monthly budget; log two expenses; query spending summary; verify totals and remaining budget are accurately reported.

**Acceptance Scenarios**:

1. **Given** the user sends `/summary` (or equivalent), **When** the command is received, **Then** the bot replies with total spent this month, remaining budget, and a breakdown by tag.
2. **Given** every new expense is logged (manually or automatically), **When** the record is stored, **Then** the bot's notification includes current-month total and remaining budget.
3. **Given** total spending reaches 90% of the monthly budget, **When** the next expense is logged, **Then** the bot's response highlights the near-limit status.

---

### Edge Cases

- What happens when the push notification text format changes (bank app update)? System should continue functioning for known banks; unknown formats are silently skipped (not stored).
- What happens if the government invoice API is unavailable during a nightly reconciliation? The run is skipped and retried the next night; no data is lost.
- What if two different purchases have the same amount within 3 minutes? The system creates two separate records (each notification window is per-transaction, not global). Cross-purchase collision is unlikely within a 3-minute window for different transactions.
- What if a mobile wallet notification arrives but no bank notification ever follows? The record is stored with payment method from the wallet notification alone; `bank_name` remains null.
- What if the user enters a negative amount or zero? The system rejects the input and asks for correction.

---

## Requirements

### Functional Requirements

- **FR-001**: The system MUST accept freeform natural language expense input from a designated chat channel and parse amount, items, and payment context automatically.
- **FR-002**: The system MUST store each expense with: amount (NT$ integer), items (list of name + amount), payment method (one of: `credit_card`, `prepaid_wallet`, `easy_card`, `bank_account`, `cash`), optional wallet identifier (`line_pay`, `google_pay`), optional bank name, optional tags, and timestamp.
- **FR-003**: The system MUST reply to every logged expense with the current month's total spending and remaining budget.
- **FR-004**: The system MUST intercept bank and mobile-payment push notifications on the user's Android device and automatically submit parsed expenses without user interaction.
- **FR-005**: The system MUST ignore push notifications that represent fund transfers rather than spending: EasyCard auto top-up (keywords: 自動加值, 自動補值) and ATM cash withdrawal (keywords: 提款, 提現, ATM).
- **FR-006**: The system MUST detect when multiple push notifications for the same purchase arrive within a 3-minute window (identified by matching amount) and merge them into a single expense record, combining `bank_name` and `wallet` fields rather than creating duplicates.
- **FR-007**: The system MUST run a nightly reconciliation job that fetches e-invoice records from the government invoice platform and attempts to match them to existing unmatched expense records by amount and time proximity.
- **FR-008**: When a reconciliation match is found, the system MUST update the expense record with item-level detail and edit the original chat notification message to reflect the enriched data.
- **FR-009**: When multiple unmatched records share the same amount in the matching window during reconciliation, the system MUST send an ambiguous-match alert in chat and await explicit user confirmation before writing the match.
- **FR-010**: The system MUST allow the user to set a monthly total budget target and track cumulative spending against it.
- **FR-011**: The system MUST operate correctly when the Android device is temporarily offline — expenses captured while offline MUST be submitted automatically once connectivity is restored.
- **FR-012**: The system MUST support querying the current spending summary on demand from chat.
- **FR-013**: The system MUST support a `fee [amount] [description]` command in both the chat interface and the Android prompt that creates a new linked fee transaction (国外交易服務費 or any deferred charge) referencing a prior transaction matched by description. If multiple candidates match, the user is presented with a selection list. The original transaction record is never modified.

### Key Entities

- **Transaction**: A single expense record. Attributes: unique ID, amount (NT$ integer), items (structured list of item name + sub-amount), payment method, wallet (optional), bank name (optional), tags (free-form list), matched-invoice flag, matched invoice reference, chat message reference, parent transaction reference (optional — set when the record is a linked fee such as 國外交易服務費), timestamps.
- **Monthly Budget**: A configuration value (NT$ integer) representing the user's spending cap for a calendar month.
- **Invoice**: A government e-invoice record retrieved from the invoice platform. Attributes: invoice number, anti-forgery random code (隨機碼, 4 chars), merchant name, merchant tax ID (統一編號), issue date, total amount, line items (name + amount each). Uniqueness is enforced by the composite key `(invoice_number, invoice_date, seller_tax_id, random_code)` — invoice number alone can recur across allocation periods; the random code eliminates all remaining collision scenarios.
- **Tag**: A freeform label attached to a transaction for later filtering (e.g., `food`, `transport`). No budget cap per tag.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: At least 95% of credit card and mobile-wallet purchases are captured automatically without any manual input from the user.
- **SC-002**: A manually entered expense is stored and acknowledged (with budget status) within 5 seconds of submission.
- **SC-003**: An automatically captured push-notification expense is stored within 30 seconds of the notification arriving on the device, even when the internet connection is briefly interrupted at time of notification.
- **SC-004**: Multi-notification deduplication correctly merges ≥95% of same-purchase multi-app notification clusters into a single expense record.
- **SC-005**: Nightly reconciliation successfully matches ≥90% of card expenses to their corresponding government invoice when an invoice exists.
- **SC-006**: Ambiguous reconciliation matches (same amount, multiple candidates) are never auto-resolved — 100% of such cases go to the user for confirmation.
- **SC-007**: The system remains fully operational after the Android device has been offline for up to 24 hours — no expense data is lost.
- **SC-008**: The monthly budget summary query returns accurate totals within 2 seconds.

---

## Clarifications

### Session 2026-05-06

- Q: How should foreign transaction service fees (國外交易服務費) be recorded? → A: `fee [amount] [description]` command available in both Discord and Android prompt. Creates a new linked transaction (child) referencing the original (parent) via `parent_transaction_id`. Original transaction is never modified. If multiple parent candidates match, user selects from a list before the fee record is created.
- Q: What fields should form the receipts unique constraint? → A: `UNIQUE (invoice_number, invoice_date, seller_tax_id, random_code)` — invoice_number alone can recur across MOF allocation periods; invoice_date pins the period; seller_tax_id pins the issuer; random_code (隨機碼, 4-char anti-forgery code) eliminates all remaining collision scenarios and requires a new `random_code` column in the receipts table.

---

## Assumptions

- The system serves a single user; no multi-user access control or data partitioning is required.
- The user's Android device remains the sole notification source; the system does not need to support multiple devices simultaneously.
- The user uses a mobile barcode carrier registered with the government invoice platform; no citizen certificate (自然人憑證) is required.
- EasyCard actual spend transactions (e.g., transit, convenience store) generate no push notifications and must always be entered manually via chat.
- `bank_account` direct-debit expenses may generate push notifications; ATM cash withdrawals from the same bank also generate push notifications but must be ignored (they represent cash retrieval, not spending).
- The monthly budget is a single calendar-month total; no per-tag or per-category sub-budgets are needed in the initial version.
- Chat interaction occurs in a single dedicated channel; the user is the only person posting expense entries in that channel.
- Internet access is available on the Android device most of the time; brief offline periods (up to 24 hours) must be handled gracefully, but extended offline operation is out of scope.
- Tags are applied manually after the fact or inferred by Gemini from item descriptions; there is no mandatory tagging requirement per transaction.
