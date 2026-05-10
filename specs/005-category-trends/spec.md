# Feature Specification: Category Tags & Trend Charts

**Feature Branch**: `005-category-trends`
**Created**: 2026-05-09
**Status**: Draft
**Input**: Conversation design session covering hierarchical expense categories, improved expense entry parsing, and time-windowed trend chart summaries with drill-down.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Hierarchical Expense Tagging (Priority: P1)

The user records an expense with a category and optional subcategory in a single command. The system correctly identifies the category, subcategory, merchant note, payment method, and individual items from a comma-separated description — and warns if the itemised amounts do not add up to the total.

**Why this priority**: Categorised data is the prerequisite for all charting. Without reliable category extraction, summaries are meaningless. This also hardens the existing `/expense` parsing with a clearer, unambiguous format.

**Independent Test**: Can be fully tested by issuing `/expense` commands with various combinations of tags, items, and notes, then verifying the stored transaction fields match expectations. Delivers immediate value: cleaner data entry with sum validation.

**Acceptance Scenarios**:

1. **Given** a user types `/expense amount:300 description:信用卡, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50`, **When** the command is processed, **Then** the transaction is saved with payment method = credit card, tag = `食:午餐`, note = `麥當勞`, items = [{大麥克套餐, 250}, {蘋果派, 50}], and no warning (250+50=300).

2. **Given** a user types `/expense amount:350 description:現金, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50`, **When** the command is processed, **Then** the confirmation message includes a mismatch warning: item sum is 300 ≠ total 350.

3. **Given** a user types `/expense amount:35 description:悠遊卡, 亞東醫院→忠孝復興, #行:捷運`, **When** the command is processed, **Then** payment method = easy card, tag = `行:捷運`, note = `亞東醫院→忠孝復興`, items = [].

4. **Given** a user types `/expense amount:80 description:現金, #三商巧福` (no category prefix), **When** the command is processed, **Then** the tag is stored as `三商巧福` (no colon), and the transaction is counted under `其他` in category summaries.

5. **Given** a description contains two or more `#category:subcategory` tokens, **When** the command is processed, **Then** only the first category tag is applied and the user sees a warning that only one category per transaction is supported.

---

### User Story 2 — Category Spending Summary Chart (Priority: P2)

The user runs a `/summary` command with a time window and receives a pie chart showing spending broken down by top-level category (食, 衣, 住, 行, 其他, etc.) for that period.

**Why this priority**: This is the primary payoff of the categorisation work — an at-a-glance view of where money is going across a meaningful time span.

**Independent Test**: Can be tested by seeding transactions with known category tags across a date range and verifying the chart reflects correct totals per category. Delivers standalone value as a monthly/quarterly spending overview.

**Acceptance Scenarios**:

1. **Given** transactions with category tags exist in the last 30 days, **When** the user runs `/summary period:month`, **Then** the bot replies with a pie chart image showing NT$ totals per category and a text breakdown table below it.

2. **Given** the user runs `/summary period:half-year`, **When** the bot responds, **Then** the chart covers the last 6 calendar months and labels each slice with category name + total amount.

3. **Given** some transactions have no category tag, **When** the chart is generated, **Then** those transactions are grouped under `其他` and included in the chart.

4. **Given** all transactions in the period belong to one category, **When** the chart is generated, **Then** a single-slice chart is shown (not an error).

---

### User Story 3 — Category Drill-Down Chart (Priority: P3)

After viewing the top-level category summary, the user taps a button for a specific category (e.g., 食) and receives a follow-up bar chart showing spending broken down by subcategory (e.g., 午餐, 晚餐, 超市) for the same period.

**Why this priority**: The top-level chart shows *what* category is over budget; the drill-down shows *which merchant or subcategory* is the culprit. Together they form the complete review workflow.

**Independent Test**: Can be tested independently by triggering a drill-down on a category with known subcategory data and verifying the bar chart totals. Depends on US2 for the entry point but is separately deliverable.

**Acceptance Scenarios**:

1. **Given** the user has received a category summary chart, **When** the user taps the `食` button, **Then** the bot replies with a bar chart showing spending per subcategory under `食` (午餐, 晚餐, 超市, etc.) for the same time window.

2. **Given** the selected category has only one subcategory, **When** the drill-down runs, **Then** a single-bar chart is shown with the full amount.

3. **Given** the selected category has no subcategory (tag was stored without a colon), **When** the drill-down runs, **Then** the chart shows a single bar labelled `其他` with the full category total.

4. **Given** the user taps a drill-down button, **When** the bot is processing, **Then** the bot responds within 3 seconds (deferred response acceptable for chart generation).

---

### Edge Cases

- What if `/summary` is run with no transactions in the requested period? → Return a text message "此期間無支出記錄" without a chart.
- What if a category name itself contains a colon (e.g., `#食:港式:飲茶`)? → Only the first colon is the delimiter; everything after is the subcategory name (`港式:飲茶`).
- What if a token is ambiguous between a payment method and a merchant name (e.g., a store called `現金商店`)? → Payment method keywords are an exact closed enum match; `現金商店` does not match `現金` exactly and is treated as a note.
- What if the same subcategory name appears under different categories (e.g., `食:午餐` and `行:午餐`)? → Each is distinct; subcategory lookup is always scoped to its parent category.
- What if there are more than 5 categories in the pie chart? → Show top 5 by total amount; group the rest into `其他`.

## Requirements *(mandatory)*

### Functional Requirements

**Expense Entry Parsing**

- **FR-001**: The expense description field MUST be parsed as comma-separated tokens; each token is classified independently.
- **FR-002**: A token starting with `#` MUST be treated as a category tag. If the token contains `:`, the portion before the first `:` is the category and everything after is the subcategory. If no `:`, the whole token (minus `#`) is stored as an uncategorised tag.
- **FR-003**: A token matching an exact payment method keyword (現金, 信用卡, 悠遊卡, 行動支付, 銀行轉帳, and their common English equivalents) MUST be mapped to the corresponding payment method enum value.
- **FR-004**: A token whose last word is a number MUST be treated as a line item (name = everything before the number, amount = the number). Tokens without a trailing number, without `#`, and not matching a payment keyword MUST be concatenated into the transaction note.
- **FR-005**: Only one category tag (`#category:subcategory`) is permitted per transaction. If more than one `#category:subcategory` token appears in the description, the system MUST use the first and warn the user in the confirmation message. Additional plain `#tag` tokens (no `:`) are allowed and stored alongside the category tag, but do not affect category chart grouping.
- **FR-006**: If the sum of all parsed item amounts does not equal the total transaction amount, the system MUST include a mismatch warning in the confirmation message but still save the transaction.
- **FR-007**: Freeform text tokens (note fragments) with no trailing number MUST NOT be created as line items.

**Category Summary**

- **FR-008**: The `/summary` command MUST accept a `period` parameter with values: `month` (current calendar month), `last-month`, `3months`, `half-year`, `year`, `all` (entire recorded history from earliest transaction to today).
- **FR-009**: The summary MUST produce a pie chart image showing total spending per top-level category for the selected period, with each slice labelled with category name and NT$ total.
- **FR-010**: Transactions whose tags have no category prefix MUST be grouped under `其他` in all charts and tables.
- **FR-011**: The summary response MUST include one interactive button per category present in the data (max 5 buttons), enabling drill-down into that category.
- **FR-012**: If more than 5 distinct categories exist in the period, the top 5 by total amount each get a button; the remainder are visible in the chart under `其他` with no drill-down button.

**Drill-Down**

- **FR-013**: Tapping a category button MUST produce a bar chart showing total spending per subcategory within that category for the same time period as the originating summary.
- **FR-014**: If a category's transactions have no subcategory (uncategorised tag or plain tag without `:`), the drill-down chart MUST show a single bar labelled `其他` with the full category total.

### Key Entities

- **Tag**: A string stored on a transaction, formatted as `category:subcategory` or plain `subcategory`. Category is derived at read time by splitting on the first `:`.
- **Category**: The portion of a tag before the first `:`. A virtual grouping — not a separately stored entity.
- **Subcategory**: The portion of a tag after the first `:`, or the full tag string if no `:` is present.
- **SummaryPeriod**: The time window for a chart query — one of: month, last-month, 3months, half-year, year.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can record a fully categorised, multi-item expense in a single `/expense` command with no additional steps compared to the current flow.
- **SC-002**: The category summary chart appears in Discord within 5 seconds of the `/summary` command being issued.
- **SC-003**: The drill-down subcategory chart appears within 3 seconds of a category button being tapped.
- **SC-004**: 100% of transactions, including those with no category tag, appear in summary charts — zero transactions are silently excluded.
- **SC-005**: A sum mismatch warning is always shown in the same message as the transaction confirmation; it is never silently swallowed.

## Clarifications

### Session 2026-05-09

- Q: Should `/summary` support an "all time" period option covering the entire recorded history? → A: Yes — `all` is a valid period value showing all expenses from the earliest transaction to today.
- Q: Can a transaction carry additional plain tags alongside one category tag? → A: Yes (Option A) — one `#category:subcategory` plus any number of plain `#tag` tokens; plain tags are stored but do not affect category chart grouping or summary calculation.

## Assumptions

- Single user system; no per-user category namespacing required.
- The existing flat `tags` array on transactions is sufficient storage; no new database tables are needed for categories.
- Category names are user-defined freeform strings — there is no predefined required taxonomy (食/衣/住/行 are examples, not an enforced enum).
- Chart rendering uses an external image generation service; no image processing runs locally on the server.
- The `/summary` command replaces or extends existing basic `/summary` behaviour; backwards compatibility with any previous summary format is not required.
- The Android notification capture pipeline is out of scope for this spec; it continues to produce flat tags and will be addressed in a later spec.
