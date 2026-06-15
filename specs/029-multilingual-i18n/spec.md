# Feature Specification: Multilingual (i18n) Support

**Feature Branch**: `029-multilingual-i18n`
**Created**: 2026-06-15
**Status**: Draft
**Input**: User description: "Add multilingual / internationalization (i18n) support to the PWA. Today all UI strings are hardcoded in Traditional Chinese (zh-TW) throughout pwa/src with no i18n library. Introduce an i18n foundation so UI text can be served in multiple languages, extract existing hardcoded zh-TW strings into a message catalog, add at least English (en) alongside Traditional Chinese (zh-TW) as the initial baseline language, let the user switch language and have the choice persist across sessions, and default sensibly to the user's existing zh-TW experience."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch language and have it stick (Priority: P1)

The user opens the app's settings, picks their preferred display language (Traditional Chinese or English), and the entire interface immediately reflects that choice. When they close and reopen the app, the app is still in the language they picked — they never have to choose again.

**Why this priority**: This is the core value of the feature. Without a working, persistent language switch, none of the other work is observable or useful. It is the smallest slice that delivers an end-to-end multilingual experience.

**Independent Test**: With only this story implemented (and at least the most visible screen translated), change the language in settings, confirm the visible UI updates without losing the current screen, fully reload/restart the app, and confirm the chosen language is retained.

**Acceptance Scenarios**:

1. **Given** the app is showing Traditional Chinese, **When** the user selects English in settings, **Then** the visible UI chrome switches to English without a manual reload and without losing their place.
2. **Given** the user has selected English, **When** they close the app and reopen it later, **Then** the app opens in English.
3. **Given** the user has selected English, **When** they switch back to Traditional Chinese, **Then** the UI returns to the exact original Traditional Chinese wording.

---

### User Story 2 - Complete, faithful translations across the app (Priority: P2)

Every piece of static interface text the user can encounter — screen titles, buttons, form labels and placeholders, validation and error messages, empty states, and confirmations — is available in both supported languages, with no untranslated text leaking through in either language.

**Why this priority**: A language switch that only covers part of the app produces a jarring mixed-language experience. Full coverage is what makes the feature trustworthy, but it builds on the P1 switching mechanism.

**Independent Test**: Set the language to English and walk through every screen and dialog, confirming no Traditional Chinese chrome remains; then set it to Traditional Chinese and confirm the wording is identical to today's app.

**Acceptance Scenarios**:

1. **Given** the language is English, **When** the user navigates every screen and opens every dialog/sheet, **Then** all static UI text appears in English with no residual Traditional Chinese chrome.
2. **Given** the language is Traditional Chinese, **When** the user views any screen, **Then** the wording matches the current (pre-feature) app exactly.
3. **Given** a UI string has no translation in the selected language, **When** that string is displayed, **Then** the user sees the Traditional Chinese base text rather than a blank, a raw key, or broken text.

---

### User Story 3 - Sensible default for first-time / returning users (Priority: P3)

A user who has never chosen a language sees the app in Traditional Chinese, exactly as they do today — the feature is invisible until they opt to change it.

**Why this priority**: Preserves the existing experience and avoids surprising current users. It depends on the persistence and default-resolution logic but is a refinement on top of the core switch.

**Independent Test**: Clear any stored language preference, open the app fresh, and confirm it displays in Traditional Chinese.

**Acceptance Scenarios**:

1. **Given** no language preference has ever been stored, **When** the user opens the app, **Then** it displays in Traditional Chinese.
2. **Given** a previously stored preference exists, **When** the user opens the app, **Then** that stored preference is honored over the default.

---

### Edge Cases

- **Missing translation key**: A string present in the base language but absent in the selected language falls back to the Traditional Chinese base text (never a blank, raw key, or crash).
- **Switching mid-task**: Changing language while a form is partially filled keeps the in-progress input intact and only re-labels the surrounding chrome.
- **Data vs. chrome**: User data and database-sourced content (category and subcategory display names, transaction descriptions, autocomplete suggestions, imported invoice data) are *not* translated and appear in their stored form regardless of selected language.
- **Unsupported stored value**: If a stored preference references a language that is no longer supported, the app falls back to the default (Traditional Chinese).
- **Dynamic message assembly**: Strings that combine fixed text with values (counts, amounts, names) read correctly in both languages, including word order differences.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to select their display language from the set of supported languages via the app's existing settings surface.
- **FR-002**: System MUST persist the selected language on the device so the choice survives app restarts and sessions.
- **FR-003**: System MUST apply a newly selected language to all static UI chrome without requiring a manual reload and without discarding the user's current screen or in-progress input.
- **FR-004**: System MUST support Traditional Chinese (zh-TW) and English (en) at launch.
- **FR-005**: When no language preference is stored, system MUST default to Traditional Chinese (zh-TW).
- **FR-006**: System MUST present every static UI string — including screen titles, navigation labels, buttons, form labels, input placeholders, validation messages, error messages, empty states, and confirmation/notification text — in the selected language.
- **FR-007**: When a string has no translation in the selected language, system MUST fall back to the Traditional Chinese base text rather than displaying an empty value, a raw key, or broken text.
- **FR-008**: System MUST keep the extracted Traditional Chinese strings identical in wording to the current app, so the default experience is visually unchanged.
- **FR-009**: System MUST leave user data and database-sourced content (category/subcategory names, transaction descriptions, autocomplete suggestions, imported data) unaffected by the selected language.
- **FR-010**: The set of supported languages MUST be extensible such that adding a future language requires supplying a new set of translations only, without altering individual screens or components.

### Key Entities

- **Supported Language**: A language the app can display, identified by a standard locale code (e.g., `zh-TW`, `en`) with a human-readable display name shown in the language picker.
- **Message Catalog**: The complete set of UI strings for one language, organized by stable keys so the same key resolves to the right text in each language.
- **Language Preference**: The user's chosen language, stored on the device and resolved at startup (stored value → default `zh-TW`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can switch the app between Traditional Chinese and English from a single settings control, and 100% of visible static UI chrome updates to the selected language within the same session (no manual reload).
- **SC-002**: With English selected, zero Traditional Chinese chrome strings remain visible across all screens and dialogs; with Traditional Chinese selected, wording matches the pre-feature app exactly.
- **SC-003**: A language selection persists across at least one full app close-and-reopen cycle in 100% of cases.
- **SC-004**: A first-time user with no stored preference sees the app in Traditional Chinese 100% of the time (existing experience unchanged).
- **SC-005**: A new language can be made available by supplying one additional translation set, with no changes required to individual screens or components.
- **SC-006**: No user data or database-sourced content (category names, descriptions, imported data) changes appearance when the language is switched.

## Assumptions

- **Two languages for v1**: The baseline ships Traditional Chinese (zh-TW) and English (en). The structure anticipates more languages later, but only these two are delivered now.
- **Default is Traditional Chinese**: Absent a stored choice, the app defaults to zh-TW to preserve today's experience. Auto-detecting the device/browser language is intentionally *not* used for v1 to avoid changing the current default behavior.
- **Scope is static UI chrome only**: Translatable text means fixed interface text. User-entered and database-sourced content (category/subcategory names, transaction descriptions, autocomplete suggestions, imported invoice data) stays in its stored form and is out of scope.
- **Formatting unchanged for v1**: Locale-specific formatting of numbers, currency, and dates is out of scope; current formatting is retained regardless of language.
- **Per-device preference**: The language choice is stored locally on the device using the same client-side preference mechanism as existing app settings; it is not synced to a backend account.
- **English wording is new copy**: English translations are newly authored to match the intent of the existing Traditional Chinese strings; professional/native review is out of scope for v1.
- **Single-user personal app**: This is a personal expense tracker; "users" refers to the app's owner across their devices, not a multi-tenant audience.
