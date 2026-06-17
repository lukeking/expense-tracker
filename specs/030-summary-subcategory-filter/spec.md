# Feature Specification: Summary Subcategory Filter

**Feature Branch**: `030-summary-subcategory-filter`  
**Created**: 2026-06-17  
**Status**: Draft  
**Input**: User description: "在 summary 畫面，點擊圓餅圖隨便一個 major category，進入該分類的 summary 畫面，上方長條圖都是該 major category 底下的 subcategory，下面的 tx 也都是 filter 過的結果，但點擊長條圖只會顯示 Total tip，底下的 tx 並不會進一步 filter，我希望改成這邊可以做第二層的 subcategory filter"

## Clarifications

### Session 2026-06-17

- Q: How should the user clear an active subcategory filter from within the drilldown? → A: Both — tapping the active bar again (toggle) **and** a dedicated clear control.
- Q: When a subcategory is selected, what should the drilldown header total show? → A: The selected subcategory's total (with breadcrumb Major › Sub), reverting to the major total when cleared.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Filter transactions by tapping a subcategory bar (Priority: P1)

A user is viewing the spending summary, taps a major category in the pie chart, and lands on that category's drilldown view. The drilldown shows a bar chart of the subcategories that make up the major category, and below it the list of transactions for the whole major category. The user taps one subcategory's bar and the transaction list below immediately narrows to only the transactions belonging to that subcategory, so they can see exactly what drove that subcategory's spending.

**Why this priority**: This is the core of the request. Today tapping a bar only shows a total tooltip and the transaction list stays at the major-category level, forcing the user to eyeball which transactions belong to a subcategory. The second-level filter is the entire value of the feature.

**Independent Test**: From the summary screen, drill into a major category that has at least two subcategories, tap one subcategory bar, and confirm the transaction list below shows only that subcategory's transactions (and excludes transactions from sibling subcategories). Delivers the primary value on its own.

**Acceptance Scenarios**:

1. **Given** a major-category drilldown view with multiple subcategory bars and the full major-category transaction list below, **When** the user taps a subcategory bar, **Then** the transaction list updates to show only transactions belonging to that subcategory.
2. **Given** a subcategory filter is active, **When** the user taps a *different* subcategory bar, **Then** the transaction list updates to that newly selected subcategory (the filter switches rather than stacks).
3. **Given** a subcategory filter is active, **When** the user reads the transaction list, **Then** the sum of the listed transactions' net amounts matches the total shown on the selected subcategory's bar.

---

### User Story 2 - Clear the subcategory filter (Priority: P2)

After narrowing the list to one subcategory, the user wants to go back to seeing all of the major category's transactions without leaving the drilldown view (i.e. without tapping "back" to the pie chart and re-drilling).

**Why this priority**: A filter that cannot be cleared in place is frustrating and traps the user. It is required for the feature to feel complete, but US1 still demonstrates the core value without it.

**Independent Test**: With a subcategory filter active, perform either clear action (re-tap the active bar, or use the dedicated clear control) and confirm the transaction list returns to showing all transactions for the major category.

**Acceptance Scenarios**:

1. **Given** a subcategory filter is active, **When** the user taps the currently selected (active) subcategory bar again, **Then** the subcategory filter clears and the list returns to the full major-category transaction list.
2. **Given** a subcategory filter is active, **When** the user taps the dedicated clear control, **Then** the subcategory filter clears and the list returns to the full major-category transaction list.
3. **Given** a subcategory filter is active, **When** the user taps "back" to return to the pie chart and then drills into any major category, **Then** no subcategory filter is active in the new drilldown.

---

### User Story 3 - See which subcategory is active (Priority: P3)

The user can tell at a glance which subcategory the transaction list is currently filtered to.

**Why this priority**: Without a clear active-state indicator the filtered list is ambiguous (the user may forget which bar they tapped). It is polish on top of US1/US2, not a blocker for demonstrating the filter.

**Independent Test**: Tap a subcategory bar and confirm there is a clear visual indication (e.g. a highlighted bar and/or a label naming the active subcategory) distinguishing the selected subcategory from the others.

**Acceptance Scenarios**:

1. **Given** a subcategory filter is active, **When** the user looks at the drilldown view, **Then** the selected subcategory is visually distinguished from the unselected subcategories.
2. **Given** a subcategory filter is active, **When** the user looks at the drilldown header, **Then** it shows a breadcrumb (Major › Subcategory) and the headline total is the selected subcategory's total; **When** the filter is cleared, **Then** the header reverts to the major category and its total.

---

### Edge Cases

- **"Other" (`其他`) subcategory bucket**: The `其他` subcategory aggregates spending that includes transactions/items with no specific subcategory tag. Filtering to `其他` MUST return the same set of transactions that the `其他` bar total represents (FR-005), even though those transactions are identified differently from normally-tagged subcategories.
- **Composing with existing filters**: When a tag filter and/or payment-method filter is already active, selecting a subcategory MUST further narrow within those filters (AND), not replace them.
- **Time period / time base change while filtered**: Changing the period (prev/next or picker) or switching the time base (week/month/year/all) while a subcategory is selected resets the subcategory selection along with the drilldown, consistent with current drilldown reset behavior.
- **Refunds within a subcategory**: Subcategories that include refund transactions must still satisfy the bar-total-equals-list-total consistency rule (refunds reduce the net total).
- **Single-subcategory major category**: A major category with only one subcategory still allows selecting/clearing that single subcategory; the filtered list equals the unfiltered list in that case.
- **Empty subcategory result**: Selecting a subcategory that resolves to no listable transactions shows the standard "no transactions" empty state rather than an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: In the major-category drilldown view, the system MUST let the user select a subcategory by tapping its bar in the subcategory bar chart.
- **FR-002**: When a subcategory is selected, the system MUST filter the transaction list below the chart to only the transactions belonging to that subcategory of the current major category.
- **FR-003**: Selecting a different subcategory bar MUST replace the active subcategory selection (selections do not stack); only one subcategory filter is active at a time.
- **FR-004**: The subcategory filter MUST compose (AND) with the already-active major category, the selected time period/time base, and any active tag and payment-method filters — consistent with how the major-category drilldown already filters the list.
- **FR-005**: The transactions listed for a selected subcategory MUST be consistent with that subcategory's bar total — i.e. the net sum of the listed transactions equals the value shown on the bar — including for the `其他`/Other bucket.
- **FR-006**: Users MUST be able to clear the active subcategory filter from within the drilldown view (without navigating back to the pie chart) and return to the full major-category transaction list, via **both** of: (a) tapping the currently selected bar again (toggle), and (b) a dedicated clear control shown while a subcategory is selected.
- **FR-007**: The system MUST reset any active subcategory selection when the user leaves the drilldown (returns to the pie chart), drills into a different major category, changes the time period, or switches the time base.
- **FR-008**: The system MUST visually indicate which subcategory is currently selected, distinguishing it from the unselected subcategories.
- **FR-009**: While a subcategory is selected, the drilldown header MUST show a breadcrumb (major category › subcategory) and display the **selected subcategory's total** as the headline figure; when the selection is cleared, the header MUST revert to the major category alone with the major-category total.

### Key Entities *(include if feature involves data)*

- **Major category**: The top-level spending grouping the user drilled into from the pie chart (e.g. `飲食`). Already drives the current drilldown.
- **Subcategory**: A second-level grouping under a major category (e.g. `飲食:早餐`), represented as one bar in the drilldown bar chart. Selecting it is the new filter dimension introduced by this feature. Includes the special `其他`/Other bucket for spend without a specific subcategory.
- **Transaction (list row)**: An expense/refund record already shown in the drilldown list; this feature changes which subset is displayed, not the row content.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a major-category drilldown, a user can narrow the transaction list to a single subcategory in one tap.
- **SC-002**: For any selected subcategory, the net sum of the displayed transactions equals the total shown on that subcategory's bar in 100% of cases (including the `其他` bucket and subcategories containing refunds).
- **SC-003**: A user can clear the subcategory filter and restore the full major-category list in one tap, without leaving the drilldown view.
- **SC-004**: At any time while a subcategory filter is active, the user can identify which subcategory the list is filtered to from the on-screen indication, without re-tapping any bar.

## Assumptions

- **Scope is the PWA Summary screen only.** This is a client-side interaction change on the existing major-category drilldown; the existing transaction-listing capability is reused. No new screen is introduced.
- **No backend change is required.** The existing transaction list already supports filtering by a category value that matches an exact tag or a `major:` prefix, so a `major:subcategory` value can drive the second-level filter. The `其他`/Other bucket (FR-005) is the one case that may need special handling to stay consistent with the bar total; this is resolved at planning time, not a scope question.
- **Clear mechanism** (resolved in Clarifications): both tapping the active bar again (toggle) and a dedicated clear control, in addition to the implicit reset on leaving/changing the drilldown context (FR-007).
- **Header total** (resolved in Clarifications): a breadcrumb (major category › subcategory) with the selected subcategory's total as the headline figure, reverting to the major-category total on clear. The exact visual treatment is finalized at planning time (a UI mockup will be presented before implementation, per project convention for non-trivial UI changes).
- **Date/number formatting, category names, and transaction row content are unchanged.** Only the displayed subset and the active-state indication change.
- **Both languages (zh/en) are supported** using the existing in-house i18n; any new UI label (e.g. a header separator or active-state text) is added to both message catalogs.
