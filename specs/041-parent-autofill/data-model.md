# Phase 1 Data Model: 連結原始交易 auto-fill

**Feature**: 041-parent-autofill | **Date**: 2026-06-28

No database schema change. This describes (a) the extended parent-search result that carries the data needed to auto-fill, and (b) the ephemeral form view-state that governs non-destructive fill. The persisted `transactions` row is unchanged — a submitted fee/refund still only stores `parent_transaction_id`.

## 1. Parent-search result (transport)

`ParentSearchResult` (shared between `backend` response and `pwa/src/components/ParentSearch.tsx`) gains two fields:

| Field | Type | Source | Notes |
|---|---|---|---|
| `id` | `string` | tx.id | existing |
| `amount` | `number` | tx.amount | existing; consumed by 全額退款 |
| `note` | `string \| null` | tx.note | existing; description fallback label |
| `tags` | `string[]` | tx.tags | existing |
| `transaction_at` | `string` | tx.transaction_at | existing |
| `item_names` | `string[]` | item names | existing; description fallback label |
| **`payment_method`** | `string` | tx.payment_method | **new** — one of `cash \| credit_card \| easy_card \| prepaid_wallet \| bank_account` |
| **`category`** | `string \| null` | derived (D1) | **new** — the single `主:子` tag, or `null` when zero / ambiguous |

### Derived field: `category` (resolution rule)

```
resolveSingleCategory(txTags, itemTagsLists):
  catTags = distinct( [...txTags, ...flatten(itemTagsLists)].filter(t => t.includes(':')) )
  return catTags.size === 1 ? the one tag : null
```

- Input: the candidate's transaction-level `tags` and each item's `tags`.
- Output: a `主:子` category tag (same shape the fee form already submits), or `null`.
- `null` cases: uncategorized parent (no colon tag), or multiple distinct categories (ambiguous multi-item legacy expense).
- Single case: the normal feature-027 "B2" shape (tx-level SSOT category, inherited by items) → exactly one distinct tag.

## 2. Form view-state (ephemeral, per tab)

Auto-fill is create-time only; all of this is component state cleared on submit/reset.

### FeeForm (手續費)

| State | Type | Auto-fillable | Touched flag | Fill rule on parent select |
|---|---|---|---|---|
| `amount` | string | no | — | never (FR-007) |
| `paymentMethod` | PaymentMethod | yes | `paymentTouched` | set to `parent.payment_method` if `!paymentTouched` |
| `category` | CategorySelection \| null | yes | `categoryTouched` | if `!categoryTouched` and `parent.category != null` → `parseCategorySelection(parent.category)` |
| `description` | string | yes (when empty) | — (empty == untouched) | existing behavior: fill from parent label if `description` is empty |
| `parent` | ParentSearchResult \| null | — | — | the link itself |

### RefundForm (退款)

| State | Type | Auto-fillable | Touched flag | Fill rule on parent select |
|---|---|---|---|---|
| `amount` | string | no (but 全額退款 button) | — | never auto; 全額退款 sets it to `parent.amount` |
| `paymentMethod` ("退款至") | PaymentMethod | yes | `paymentTouched` | set to `parent.payment_method` if `!paymentTouched` |
| `description` | string | yes (when empty) | — (empty == untouched) | **new**: fill from parent label if `description` is empty (parity with fee) |
| `parent` | ParentSearchResult \| null | — | — | the link itself |

> The refund form has **no category** field, so category auto-fill does not apply there (FR-005).

### "Touched" semantics

- A touched flag flips to `true` when the user changes that field by hand (via `PaymentPills.onChange` / `CategoryPicker.onChange`).
- Auto-fill (on select **or** re-link) writes a field only when its flag is `false`.
- `description` uses "is empty" as its untouched test (matches existing fee behavior) — no separate flag needed.
- Submit/reset clears parent + all touched flags along with the other fields.

## 3. Persisted entity (unchanged)

The created fee/refund `transactions` row is written by the existing `POST /pwa/fee` and `POST /pwa/refund` handlers with the same body as today (`amount`, `payment_method`, `category_tag` for fee, `description`, `parent_transaction_id`). Auto-fill only changes what those fields *start as* in the form; the write contract and stored shape are untouched. After submit, the original is reachable solely via `parent_transaction_id`.
