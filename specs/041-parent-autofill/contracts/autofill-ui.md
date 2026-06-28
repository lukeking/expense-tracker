# Contract: Entry-form auto-fill behavior

**Feature**: 041-parent-autofill | **Date**: 2026-06-28

Defines exactly what happens to each form field on the 手續費 / 退款 tabs as the user links, re-links, or clears an original transaction. Governing rule: **non-destructive + create-time only** — auto-fill never overwrites a field the user has touched, and nothing happens after submit.

## Trigger: user selects (links) an original

For each auto-fillable field, write the parent's value **only if the field is untouched**:

| Field | 手續費 | 退款 | Untouched test | Value written |
|---|---|---|---|---|
| Payment method | ✅ | ✅ ("退款至") | `!paymentTouched` | `parent.payment_method` |
| Category | ✅ | — (no field) | `!categoryTouched` **and** `parent.category != null` | `parseCategorySelection(parent.category)` |
| Description | ✅ (existing) | ✅ (new — parity) | `description` is empty | parent label: `note ?? item_names[0] ?? tags[0]` |
| Amount | never | never | — | — (see 全額退款 below) |

- If `parent.category` is `null` (ambiguous/uncategorized), the fee category is left as-is.
- Writing an auto-filled value does **not** set the touched flag (only a *manual* change does), so a subsequent re-link can still refresh it.

## Trigger: user manually edits a field

- Changing the payment pill sets `paymentTouched = true`.
- Changing the category picker sets `categoryTouched = true`.
- Typing in description makes it non-empty (its untouched test).
- Once touched, the field is never overwritten by a later link/re-link.

## Trigger: user re-links to a different original

- Same rule as the initial link: refresh only untouched fields to the **new** parent's values.
- Touched fields keep the user's value (acceptance scenario US1 #3).

## Trigger: user clears the link

- No field is modified. Current values (auto-filled or manual) remain. The form just loses `parent`.

## Trigger: 全額退款 (退款 tab only)

- The control is rendered **only when `parent != null`**.
- Tapping sets `amount = String(parent.amount)`.
- The amount remains a normal editable input afterward (user may trim it to a partial). Tapping again re-applies the full amount.
- No equivalent control exists on the 手續費 tab.

## Trigger: submit / reset

- On success, the form resets (amount, payment method, category, description, parent) **and clears all touched flags**, returning to a clean create state.

## Post-submit

- The saved fee/refund retains only `parent_transaction_id`. No field is ever back-filled or re-synced from the original after submission.

## Non-functional

- All writes are synchronous in-memory state updates on select — no extra network call, no spinner (the parent's data already arrived with the search result).
- New visible string `全額退款` MUST exist in both `zh.ts` and `en.ts` (`entry.fullRefund`).
