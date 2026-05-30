# Data Model: Item Row Redesign (018)

## Schema Change

### `transaction_items.note` (new column)

| Field | Type | Nullable | Constraint |
|-------|------|----------|------------|
| `note` | `TEXT` | YES | `char_length(note) <= 200` |

No backfill. All existing rows get NULL.

---

## UI State (PWA only — not persisted)

### `ItemRowData` (extended)

```ts
interface ItemRowData {
  id: string;
  tagOverride: string | null;
  name: string;
  amount: number | null;
  note: string;          // NEW — bound to line-2 input; empty → null on submit
  approxFlag: boolean;   // NEW — set by Max gross-up; cleared on manual edit
}
```

### `ExpenseForm` state additions

| State | Type | Purpose |
|-------|------|---------|
| `showAdj` | `boolean` | Controls adjustments section visibility |

`items` initialises with `[newItem()]` instead of `[]`.

---

## Max Button Formula

Computed at tap time from current form state:

```
Σabs_gross = Σ{ adj.amount : adj.kind ∈ {discount, refund}, adj.mode === 'absolute' }
           - Σ{ adj.amount : adj.kind === 'fee', adj.mode === 'absolute' }

Σpct_gross = Σ{ adj.value  : adj.kind ∈ {discount, refund}, adj.mode === 'percentage' }
           - Σ{ adj.value  : adj.kind === 'fee', adj.mode === 'percentage' }

grossTotal = round((amountVal + Σabs_gross) / (1 - Σpct_gross / 100))
maxItem    = grossTotal - Σother_item_amounts
approxFlag = (amountVal + Σabs_gross) is not exactly divisible by (1 - Σpct_gross / 100)
```

Disabled when `amountVal === 0` or `maxItem ≤ 0`.

---

## API Shape Change (POST /pwa/expense)

Item shape in request body gains optional `note`:

```ts
// Before
{ name: string; amount: number | null; tag: string | null }

// After
{ name: string; amount: number | null; tag: string | null; note?: string | null }
```

`free_tags` filtering: category-format tags (containing `:`) stripped server-side before storing on transaction.
