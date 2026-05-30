# Feature Specification: Advanced Summary Filters

**Feature Branch**: `021-summary-filters`
**Created**: 2026-05-30
**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Filter Summary by Tag (Priority: P1)

A user wants to see spending totals only for transactions that carry a specific plain tag (e.g., "travel" or "lunch"), so they can understand how much they spend in a particular informal category without changing the tag system.

**Why this priority**: Tags are already applied to many transactions; surfacing spend-by-tag is the most direct, low-friction analysis the user can do. Delivers standalone value.

**Independent Test**: Open the summary screen, tap a tag chip to filter by it, and confirm that only transactions carrying that tag appear in the totals and list. Removing the filter restores the full view.

**Acceptance Scenarios**:

1. **Given** the summary screen is open, **When** the user selects a tag from the filter bar, **Then** all summary totals and the transaction list update to show only transactions carrying that tag.
2. **Given** a tag filter is active, **When** the user taps the same tag again or taps "Clear", **Then** the filter is removed and all transactions are shown again.
3. **Given** no transactions carry the selected tag in the current time window, **When** the user selects that tag, **Then** the summary shows zero totals and an empty transaction list.
4. **Given** multiple tags exist, **When** the user selects one tag, **Then** only that tag is highlighted and transactions without it are excluded.

---

### User Story 2 — Filter Summary by Payment Method (Priority: P1)

A user wants to see spending totals limited to a specific payment method (e.g., cash vs. credit card), so they can reconcile a particular account or understand spending by instrument.

**Why this priority**: Payment method is already recorded on every transaction; isolating it is critical for reconciliation workflows and equally as direct as tag filtering.

**Independent Test**: Select a payment method filter on the summary screen and confirm totals match only transactions recorded with that method.

**Acceptance Scenarios**:

1. **Given** the summary screen is open, **When** the user selects a payment method pill, **Then** totals and the transaction list show only transactions recorded with that payment method.
2. **Given** a payment method filter is active, **When** the user selects a different method, **Then** the filter switches to the newly selected method.
3. **Given** a payment method filter is active, **When** the user deselects it, **Then** all payment methods are shown again.
4. **Given** only one payment method has been used in the time window, **When** the user selects a different method, **Then** totals show zero and the list is empty.

---

### User Story 3 — Navigate Summary by Fixed Time Window (Priority: P1)

A user wants to move backward and forward through equal-length time windows (week, month, or year) using left/right arrow buttons, so they can compare spending across periods without manually adjusting date pickers.

**Why this priority**: This is the calendar-navigation pattern the user explicitly requested; it makes historical comparison fast and intuitive and is directly analogous to how native calendar and finance apps work.

**Independent Test**: On the summary screen, tap the right arrow once and confirm the displayed window shifts forward by one unit (e.g., one month); tap left and confirm it returns to the previous window.

**Acceptance Scenarios**:

1. **Given** the summary is in "month" mode showing May 2026, **When** the user taps the left arrow, **Then** the window shifts to April 2026 and all totals and the list reload for that period.
2. **Given** the summary is in "month" mode showing May 2026, **When** the user taps the right arrow, **Then** the window shifts to June 2026.
3. **Given** the user is on the current period, **When** the right arrow is tapped, **Then** the window does not advance beyond the current date (arrow disabled or no-op).
4. **Given** the user changes the time base (e.g., month → week), **Then** the window resets to the current calendar week (Sun–Sat) and navigation uses week-sized steps from that point.
5. **Given** a time window is displayed, **Then** the header shows the window label (e.g., "May 2026", "1 Jun – 7 Jun", "2026") clearly.

---

### User Story 4 — Switch Time Base (Priority: P2)

A user wants to choose between week, month, and year as the unit of time for the summary window, so they can analyze spending at different granularities.

**Why this priority**: Required to make the navigation in Story 3 useful at multiple granularities. Dependent on Story 3 but adds meaningful self-contained value.

**Independent Test**: Switch from month to week view and confirm the window label, transaction list, and totals all update to reflect the current week only.

**Acceptance Scenarios**:

1. **Given** the summary is in month mode, **When** the user switches to "week", **Then** the view shows only the current calendar week (Sun–Sat) and the window label reflects the exact date range.
2. **Given** the user switches time bases, **Then** the left/right arrows always advance or retreat by exactly one unit of the active time base.
3. **Given** the user switches time bases while a tag or payment method filter is active, **Then** the filter remains applied in the new time base.

---

### Edge Cases

- What happens when both a tag filter and a payment method filter are active simultaneously? Both filters apply (AND logic) — only transactions matching both are shown.
- What happens when the selected time window contains no transactions? Totals show zero; list shows an empty state message.
- What happens when the user navigates far back to a period with no data? Empty state is shown; navigation is not blocked.
- What happens when a tag no longer exists in the current window (no transactions carry it)? The tag chip is absent from the filter bar for that window; switching back to a window where it exists restores it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The summary screen MUST expose a tag filter control listing all plain tags present on transactions in the current time window; the available tag list is derived from the server response for the active window.
- **FR-002**: Selecting a tag MUST trigger a new server request with the tag parameter; the returned totals and transaction list reflect only matching transactions.
- **FR-003**: The summary screen MUST expose a payment method filter showing all payment methods present in the current time window; available options are derived from the server response.
- **FR-004**: Selecting a payment method MUST trigger a new server request with the payment method parameter; the returned totals and transaction list reflect only matching transactions.
- **FR-005**: When both a tag and a payment method filter are active, only transactions matching both filters MUST be shown (AND logic).
- **FR-006**: The summary screen MUST replace the existing preset pills with a time-base selector offering three options: week, month, year. The existing 本月/上月/近3個月/近半年/近一年/全部 control is removed.
- **FR-007**: The summary screen MUST display left (◀) and right (▶) navigation arrows that shift the current window by exactly one calendar unit of the active time base.
- **FR-008**: The right arrow MUST be disabled when the current window includes the present date.
- **FR-009**: The window header MUST display a human-readable label for the current time window: month → "May 2026"; week → "1 Jun – 7 Jun"; year → "2026".
- **FR-010**: Switching the time base MUST reset the window to the current calendar period of the new base; active tag and payment method filters MUST be preserved.
- **FR-013**: On app open, the summary MUST always start at the current week (Sun–Sat) with no active tag or payment method filter. No state persists across sessions.
- **FR-011**: All filters and the time window MUST be applied together; totals and the transaction list MUST always reflect all active constraints simultaneously.
- **FR-012**: Clearing a filter MUST restore the full unfiltered view within the current time window.

### Key Entities

- **Time Window**: A start/end date range derived from the selected time base and navigation offset (0 = current, -1 = previous, etc.).
- **Tag Filter**: A selected plain tag string used to restrict which transactions appear. At most one active at a time.
- **Payment Method Filter**: A selected payment method used to restrict which transactions appear. At most one active at a time.
- **Time Base**: One of `week`, `month`, `year` — determines the granularity of the time window and navigation step size.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can isolate spending for any tag or payment method in at most 2 taps from the summary screen.
- **SC-002**: Navigating one period backward or forward takes at most 1 tap and the new data is visible within 1 second on a normal mobile connection.
- **SC-003**: All totals on the filtered summary screen match the sum of individually visible transactions (no silent inclusion or exclusion).
- **SC-004**: Switching time base while filters are active never clears those filters — 100% of filter state survives a time-base change.
- **SC-005**: The current-period guard prevents the user from navigating to a future window (right arrow disabled) in 100% of cases.

## Assumptions

- The existing summary screen's data-fetching layer can be extended to accept tag, payment method, and date-range parameters without a full rewrite.
- "Plain tags" means free-text tags only (not category tags); category-based filtering is out of scope for this feature.
- Only one tag and one payment method filter can be active at a time (no multi-select); multi-select is a future enhancement.
- All time windows are calendar-aligned, not rolling. Week = Sunday–Saturday; month = 1st to last day of the month; year = January 1 – December 31.
- The default time base on app open is "week" (current Sun–Sat window); no filters are active. Nothing persists across sessions.
- The summary screen already groups transactions by date; this feature extends the header area and filter bar without redesigning the list layout.
- Filtering is executed server-side: the API receives `from`, `to`, `tag`, and `payment_method` query parameters and returns only matching transactions. Client-side filtering of a full dataset is not used.

## Clarifications

### Session 2026-05-30

- Q: Where does filtering execute — server-side API params or client-side in-browser? → A: Server-side — API receives `from`, `to`, `tag`, `payment_method` params and returns pre-filtered data.
- Q: Are time windows calendar-aligned or rolling? Week boundary: Sunday or Monday? → A: Calendar-aligned. Week = Sunday–Saturday. Month = 1st–last day. Year = Jan 1–Dec 31.
- Q: Does filter/window state persist across app restarts? → A: No — always opens at current week, no active filters. Session-only state.
