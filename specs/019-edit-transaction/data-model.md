# Data Model: Edit Transaction (019)

## No schema changes

Feature 019 introduces no new tables, columns, or migrations. All required DB structures exist from prior features.

## Entities touched (read/write)

### `transactions` (write: header update)

| Column | Type | Edit action |
|---|---|---|
| `amount` | integer | Overwritten on save |
| `payment_method` | enum | Overwritten on save |
| `tags` | text[] | Overwritten on save (free tags only) |
| `note` | text | Overwritten on save |
| `transaction_at` | timestamptz | **Immutable** — never written |
| `transaction_type` | enum | **Immutable** — verified = `expense` before write |
| `id` | uuid | **Immutable** |

### `transaction_items` (write: full replace)

Old rows deleted by `transaction_id`, new rows inserted. Uses existing `insertTransactionItems` which accepts:

| Column | Type |
|---|---|
| `transaction_id` | uuid |
| `name` | text |
| `amount` | integer \| null |
| `tags` | text[] |
| `sort_order` | integer |
| `note` | text \| null |

`effective_amount` is recomputed after insert via `computeAndWriteEffectiveAmounts`.

### `transaction_adjustments` (write: full replace)

Old rows deleted by `transaction_id`, new rows inserted. Uses existing `insertAdjustments`.

| Column | Type |
|---|---|
| `transaction_id` | uuid |
| `kind` | `fee` \| `refund` \| `discount` |
| `amount` | integer |
| `note` | text \| null |
| `basis` | `percentage` \| null |
| `basis_value` | integer \| null |
| `source` | `manual` (always on edit) |
| `transaction_at` | timestamptz (copied from tx header) |

## Pre-fill mapping (API → form state)

### Transaction header → form fields

| API field | Form state |
|---|---|
| `amount` | `amount` (string for input) |
| `payment_method` | `paymentMethod` |
| `tags` | `freeTags` |
| `note` | `note` |
| Items' category tag | `category` (CategorySelection) |

### Category tag reconstruction

```
categoryTag = first item tag containing ':'  (or null)
categorySelection = categoryTag
  ? { major: tag.split(':')[0], subcategory: tag.split(':')[1] ?? null }
  : null
```

Each item's `tagOverride`:
- `null` if item's category tag equals derived `categoryTag`
- `itemTag` otherwise

### Adjustment row → AdjustmentRowData

| DB field | AdjustmentRowData field |
|---|---|
| `kind` | `kind` |
| `basis === 'percentage'` | `mode = 'percentage'` |
| `basis !== 'percentage'` | `mode = 'absolute'` |
| `basis_value` (when % mode) | `value` |
| `amount` (when absolute mode) | `value` |
| `note ?? ''` | `note` |
| `crypto.randomUUID()` | `id` (UI key only) |
