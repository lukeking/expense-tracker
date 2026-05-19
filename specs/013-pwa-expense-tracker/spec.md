# Feature Specification: PWA Expense Tracker

**Feature Branch**: `013-pwa-expense-tracker`
**Created**: 2026-05-19
**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Log an Expense with Items (Priority: P1)

The user opens the PWA on their phone, selects a major category (e.g., 食), taps a subcategory (e.g., 早餐), optionally adds a free tag (e.g., #日出好食), enters a total amount, adds individual item rows with names and amounts, selects payment method, and submits. The transaction and its items are saved and the entry form resets.

**Why this priority**: This is the daily core action the entire app exists to support. All other features are secondary.

**Independent Test**: Deploy the entry screen and backend expense endpoint in isolation. Submit a 3-item breakfast expense; verify transaction and items appear correctly in the database.

**Acceptance Scenarios**:

1. **Given** the Entry screen is open on the Expense tab, **When** the user selects major category 食 and subcategory 早餐, **Then** the subcategory row appears below the major chips and 早餐 is highlighted.
2. **Given** a category is selected, **When** the user adds an item row with name "火腿蛋餅" and amount 40, **Then** the live total indicator updates and shows NT$40 allocated.
3. **Given** three items totalling NT$100 and transaction amount NT$100, **When** the user submits, **Then** the transaction and three linked items are saved; the form resets to empty state.
4. **Given** items sum to NT$80 and total is NT$100, **When** the user submits, **Then** submission is allowed with NT$20 shown as unallocated (no error, null-amount remainder).
5. **Given** an item with a name but no amount set, **When** the user submits, **Then** the item is saved with a null amount (treated as unallocated, not zero).
6. **Given** no category is selected, **When** the user submits with a free tag only, **Then** the transaction is saved with the free tag and items have no category tag.

---

### User Story 2 — View Spending Summary with Drill-Down (Priority: P2)

The user opens the Summary screen, selects a time window (e.g., 本月), sees a pie chart of spending by major category, taps a category slice to drill down into subcategory bar charts, and browses the filtered transaction history below.

**Why this priority**: Understanding spending patterns is the primary reason to track expenses at all. Without this, the data is write-only.

**Independent Test**: Seed the database with transactions across multiple categories. Open the summary screen and verify pie chart reflects correct proportions; tap a slice and verify the subcategory chart and filtered history appear.

**Acceptance Scenarios**:

1. **Given** the Summary screen is open, **When** the user selects "本月" from the time window picker, **Then** only transactions within the current calendar month are reflected in charts and history.
2. **Given** transactions exist across multiple categories, **When** the pie chart renders, **Then** each major category appears as a proportional slice with label and amount.
3. **Given** the main summary view is shown, **When** the user taps the 食 pie slice, **Then** the view transitions to a subcategory bar chart filtered to 食 with a back arrow.
4. **Given** the drilldown view is open, **When** the user taps the back arrow, **Then** the main summary view is restored with the same time window.
5. **Given** the Summary screen is open, **When** transaction history is shown below the chart, **Then** entries are grouped by day/week/month according to window size and all groups are collapsed by default.
6. **Given** a history group is collapsed, **When** the user taps it, **Then** individual transactions expand showing item details.

---

### User Story 3 — Log a Fee or Refund Linked to a Parent Transaction (Priority: P3)

The user opens the Fee or Refund tab, enters an amount, types a description, searches for a parent transaction by keyword, selects the matching transaction from a filtered popup list, and submits.

**Why this priority**: Foreign transaction fees and reimbursements need to be linked to their source transaction for accurate net reporting. This is less frequent than expense entry but important for correctness.

**Independent Test**: Create a parent transaction, then submit a fee linked to it; verify the fee transaction references the correct parent in the database.

**Acceptance Scenarios**:

1. **Given** the Fee tab is open, **When** the user types a keyword in the parent search field, **Then** a popup list appears showing matching transactions from the past 90 days, filtered in real time.
2. **Given** the search returns no results within 90 days, **When** the user taps "Search older transactions", **Then** the search re-runs without a date limit.
3. **Given** a parent transaction is selected, **When** the user submits, **Then** the fee/refund transaction is saved with a reference to the selected parent.
4. **Given** the Refund tab, **When** the user submits, **Then** a payment method field is also required (same options as Expense).
5. **Given** no parent transaction is selected, **When** the user submits, **Then** the fee/refund is saved without a parent link (unlinked).

---

### User Story 4 — Import Invoice CSV (Priority: P4)

The user navigates to the Import tool, selects a CSV file exported from the government e-invoice platform, taps upload, and sees a summary of how many invoices were matched, auto-created, or skipped.

**Why this priority**: Periodic invoice reconciliation is part of the existing workflow. Moving it to the PWA reduces dependency on Discord for non-conversational tasks.

**Independent Test**: Upload a valid CSV file through the import screen; verify the result summary matches expected matched/created/skipped counts.

**Acceptance Scenarios**:

1. **Given** the Import screen is open, **When** the user selects a valid CSV file, **Then** a preview of the filename and file size is shown before upload.
2. **Given** a valid CSV is uploaded, **When** processing completes, **Then** a result summary shows matched, auto-created, skipped-duplicate, and held-forex counts.
3. **Given** an invalid or non-CSV file is selected, **When** the user attempts to upload, **Then** an error message is shown and no import is performed.

---

### User Story 5 — First-Time Authentication Setup (Priority: P5)

On first visit the user is prompted to enter their API key. After successful entry the key is stored locally and the app loads normally. On subsequent visits the stored key is used automatically.

**Why this priority**: Auth is a prerequisite for all other stories but is a one-time setup action.

**Independent Test**: Open the app in a fresh browser with no stored credentials; verify the key prompt appears, a correct key grants access, and an incorrect key shows an error.

**Acceptance Scenarios**:

1. **Given** no API key is stored, **When** the app loads, **Then** an API key prompt is shown before any other screen.
2. **Given** the user enters a correct key and submits, **When** the backend validates it, **Then** the key is stored and the app proceeds to the Entry screen.
3. **Given** the user enters an incorrect key, **When** the backend rejects it, **Then** an error message is shown and the prompt remains.
4. **Given** a valid key is already stored, **When** the app loads, **Then** the key prompt is skipped and the Entry screen loads directly.

---

### User Story 6 — Budget Progress Overview (Priority: P6)

The user opens the Budget screen and sees current month spending versus the monthly budget limit as a progress bar with percentage and amounts.

**Why this priority**: Low-frequency reference feature; infrequently used but useful for awareness.

**Independent Test**: Set a budget in the system, record some expenses, open the Budget screen; verify the bar reflects current spend correctly.

**Acceptance Scenarios**:

1. **Given** the Budget screen is open, **When** it loads, **Then** current month spend, monthly budget target, and percentage are displayed.
2. **Given** spend exceeds the budget, **When** the screen loads, **Then** the bar is filled and visually indicates over-budget status.

---

### Edge Cases

- What happens when the subcategory list for a major category exceeds 8 items? → Show top items in horizontal scroll; a `···` chip opens a bottom sheet with full list and search.
- What happens when an item amount stepper is at minimum and the user taps `−`? → Stepper does not go below 1; to clear the amount, the user can delete the value to return to null (—) state.
- What happens when items sum exceeds the transaction total? → A visible error indicator appears on the total-match line; submission is blocked until corrected.
- What happens when a network request fails during submission? → An error message is shown; form data is preserved so the user does not lose their input.
- What happens when the user has no transactions for the selected summary period? → An empty state message is shown in place of charts and history.
- What happens when the CSV import contains only voided or zero-amount invoices? → The result summary shows zero valid invoices and an explanatory message.

---

## Requirements *(mandatory)*

### Functional Requirements

**Authentication**
- **FR-001**: The app MUST prompt for an API key on first load when no key is stored locally.
- **FR-002**: The app MUST store the API key locally after successful validation and reuse it automatically on subsequent visits.
- **FR-003**: All requests to the backend MUST include the stored API key; a 401 response MUST clear the stored key and return the user to the key prompt.

**Entry — Expense**
- **FR-004**: The entry form MUST support three transaction types: Expense, Fee, and Refund, selectable via tabs.
- **FR-005**: The category picker MUST display major categories as chips; selecting one MUST reveal a subcategory chip row beneath it.
- **FR-006**: When a major category has more than 8 subcategories, a `···` chip MUST appear that opens a bottom sheet with the full list and a search field.
- **FR-007**: The free-tag input MUST offer autocomplete suggestions drawn from all distinct tags already present in the system.
- **FR-008**: The item list MUST allow adding and removing rows; each row MUST have a tag selector, a name field, and an amount field.
- **FR-009**: Each item tag MUST default to the transaction-level category (shown dimmed) and MUST be overridable per row.
- **FR-010**: An item's amount MUST support a null/unset state displayed as `—`; tapping `+` for the first time sets it to 1.
- **FR-011**: A live indicator MUST show whether the sum of item amounts equals, is less than, or exceeds the transaction total; excess MUST block submission.
- **FR-012**: Items with null amounts MUST be allowed; they are saved with no amount and do not contribute to the sum check.
- **FR-013**: Payment method MUST be selectable via pill buttons for Expense and Refund; Fee always uses credit card (no payment field shown).

**Entry — Fee & Refund**
- **FR-014**: The parent transaction search MUST query transactions from the past 90 days by default.
- **FR-015**: Search results MUST filter in real time as the user types and display as a popup list.
- **FR-016**: If no results are found within 90 days, a "Search older transactions" control MUST appear to remove the date limit.
- **FR-017**: A fee or refund MAY be submitted without selecting a parent (saved as unlinked).

**Summary**
- **FR-018**: The summary screen MUST support time windows: 本月, 上月, 近3個月, 近半年, 近一年, 全部.
- **FR-019**: Spending MUST be displayed as an interactive pie chart grouped by major category; tapping a slice MUST navigate to a subcategory drilldown view.
- **FR-020**: The drilldown view MUST display a horizontal bar chart of subcategory spending and a transaction history filtered to that category; a back control MUST return to the main summary.
- **FR-021**: Transaction history MUST be grouped by day for windows ≤ 3 months, by week for ≤ 1 year, and by month for the full range; all groups MUST be collapsed by default.
- **FR-022**: Expanding a history group MUST reveal individual transactions with their linked items.

**Import**
- **FR-023**: The import tool MUST accept CSV file upload and run it through the same processing pipeline used by the Discord import command.
- **FR-024**: After processing, the import tool MUST display a result summary (matched, auto-created, skipped, held counts).

**Categories**
- **FR-025**: Major categories and their subcategories MUST be sourced from a dedicated categories table in the database, not hardcoded in the frontend.
- **FR-026**: Category tags MUST follow the existing format (`major:subcategory`) to remain compatible with Discord-logged transactions.

### Key Entities

- **Category**: A major category label (e.g., 食) optionally paired with a subcategory label (e.g., 早餐). The combined tag key (`食:早餐`) is the shared identifier across all transaction entry surfaces.
- **Transaction**: A financial record with amount, type (expense/fee/refund), payment method, tags, optional note, and timestamp. A fee or refund may reference a parent transaction.
- **Transaction Item**: A named line item linked to a transaction with an optional amount and optional tag. Items inherit the transaction category tag when no item-level tag is set.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can log a fully categorised multi-item expense from app open to confirmation in under 60 seconds.
- **SC-002**: The summary screen loads and renders charts for the current month in under 3 seconds on a standard mobile connection.
- **SC-003**: All transactions and items entered via the PWA are immediately visible in summary views and are fully compatible with data entered via Discord commands (no schema conflicts).
- **SC-004**: A user can complete first-time authentication setup in under 30 seconds.
- **SC-005**: The app is usable on a 390px-wide mobile screen without horizontal scrolling on any primary screen.
- **SC-006**: A CSV import of up to 1,000 invoice rows completes and returns a result summary without a timeout error.

---

## Assumptions

- The app is used exclusively by a single user; no multi-user, sharing, or role-based access control is required.
- The existing `ANDROID_API_KEY` Wrangler secret will be reused for PWA authentication; no separate key is needed.
- The existing backend service functions (`insertTransaction`, `insertTransactionItems`, `getBudgetProgress`, `runImportPipeline`, etc.) will be called directly from new PWA route handlers without modification.
- The categories table will be seeded with an initial set of common major categories (食/住/行/育/樂/醫) and subcategories at migration time; the user can extend it directly in the database for now.
- The PWA does not require offline support or service-worker caching in v1; a network connection is assumed for all actions.
- The existing Discord commands remain fully operational alongside the PWA; both surfaces write to the same database.
- Deployment to Cloudflare Pages is assumed; the PWA frontend and the Cloudflare Worker backend are treated as separate deployable units sharing the same domain or a configured CORS policy.
- The budget amount is already stored in the database and editable via the existing Discord `/budget` command; the Budget screen is read-only in v1.
