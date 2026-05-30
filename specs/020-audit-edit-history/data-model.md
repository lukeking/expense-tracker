# Data Model: Audit Edit History (020)

## New table: `transaction_edit_history`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT `gen_random_uuid()` | |
| `transaction_id` | `uuid` | NOT NULL, FK → `transactions(id)` ON DELETE CASCADE | Cascade: history deleted when transaction is deleted |
| `edited_at` | `timestamptz` | NOT NULL, DEFAULT `now()` | Set by the worker at insert time |
| `diff` | `jsonb` | NOT NULL | See diff schema below |

**Indexes**: `(transaction_id, edited_at)` — used by the GET handler to fetch and order history.

**Row security**: No RLS needed (existing pattern: service-role key in CF Worker, no direct client access).

---

## Diff JSONB schema

```jsonc
{
  // Header sub-object — present only if ≥1 header field changed.
  // Each key present only if that field changed.
  "header": {
    "amount":          { "before": 1200, "after": 1500 },
    "payment_method":  { "before": "cash", "after": "linepay" },
    "note":            { "before": null, "after": "lunch with team" },
    "tags":            { "before": ["work"], "after": ["work", "lunch"] }
  },

  // Items sub-object — present only if items array changed.
  "items": {
    "before": [
      { "name": "burger", "amount": 200, "tags": ["food:meal"], "note": null }
    ],
    "after": [
      { "name": "burger", "amount": 180, "tags": ["food:meal"], "note": "no sauce" },
      { "name": "fries",  "amount": 80,  "tags": ["food:meal"], "note": null }
    ]
  },

  // Adjustments sub-object — present only if adjustments array changed.
  "adjustments": {
    "before": [],
    "after": [
      { "kind": "discount", "amount": 50, "note": "coupon", "basis": null, "basis_value": null }
    ]
  }
}
```

**Empty diff rule**: If none of the three sub-objects would be present (no header fields changed, items array unchanged, adjustments array unchanged), no history row is inserted.

---

## Normalisation rules for diff comparison

- `note`: treat `null` and `""` as equivalent (same normalisation as the PUT handler's `note?.trim() || null`).
- `tags` (free tags): sort both arrays before comparing, since tag order is not significant.
- Items equality: compare each item's `{ name, amount, tags, note }` tuple; item UUIDs and `sort_order` are not included (items are fully replaced on every save).
- Adjustments equality: compare each adjustment's `{ kind, amount, note, basis, basis_value }` tuple; UUIDs are not included.

---

## GET /pwa/transactions/:id — response extension

History entries are appended under a `history` key:

```jsonc
{
  "id": "...",
  "amount": 1500,
  // ... existing fields ...
  "history": [
    {
      "id": "uuid",
      "edited_at": "2026-05-30T14:22:00Z",
      "diff": { /* diff object */ }
    }
    // oldest first
  ]
}
```

`history` is always present (empty array when no edits recorded). The PWA hides the history section when `history.length === 0`.
