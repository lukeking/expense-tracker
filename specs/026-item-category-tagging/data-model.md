# Phase 1 Data Model: Usable item-level category assignment

**No DDL / no migration.** This feature reads and writes columns that already exist. Below: the touched columns, the invariants the code must hold, and the derived predicate.

## Touched storage

### `transaction_items`
| Column | Type | Use in this feature |
|--------|------|---------------------|
| `id` | uuid (PK) | Addressed by the inline `PATCH …/items/:itemId`; newly surfaced in `/import/matched` items |
| `transaction_id` | uuid (FK) | Path/auth scoping + audit-history key |
| `tags` | text[] | **The only mutated column.** Holds at most one category tag (`major:sub` or a bare `major`) plus any plain tags |
| `amount` | int \| null | Read for attribution; **never written** here |
| `effective_amount` | int \| null | Read by aggregators; **never written** here (D2) |

### `transactions` (read-only here)
| Column | Use |
|--------|-----|
| `transaction_type` | Guard: only `expense` is editable (403 otherwise) |
| `tags` | Inheritance source for the "uncategorized" predicate |

### `transaction_edit_history` (append-only)
One row inserted per inline assignment when a diff exists: `{ transaction_id, diff: { items: { before, after } } }` (D4).

## Derived predicate — "uncategorized" (FR-007)

```
isItemUncategorized(item, tx) :=
  item.tags.every(t => !t.includes(':'))      // item has no category tag
  && tx.tags.every(t => !t.includes(':'))     // and nothing to inherit from the tx
```

Drives the `⚠ 未分類` flag on both UI surfaces. Mirrors the category-resolution already in `summary.ts:51,61`.

## Invariants

1. **Single category tag.** After any assign, `tags.filter(t => t.includes(':')).length <= 1`. Enforced by the merge rule (D7).
2. **Plain tags preserved.** Assigning/clearing a category never removes a plain tag (e.g. `全家`).
3. **Amounts immutable.** `amount` and `effective_amount` are byte-identical before/after a category assignment (D2 / FR-012).
4. **Attribution follows the tag.** Given invariant 3, the period total is unchanged; only the per-category split moves. Formally: `Σ categories (incl. 其他)` is equal before and after (SC-005).
5. **Idempotent.** Re-assigning the same `category_tag` yields identical `tags` and produces no edit-history row (empty diff).

## Lifecycle of an invoice-auto-filled item (illustrative)

```
created by import      → tags: []                         (其他 in summary)
user assigns 飲食:零食 → tags: ['飲食:零食']               (飲食 in summary)
user clears            → tags: []                         (back to 其他)
tx also had '全家' tag → tags: ['全家'] → ['全家','飲食:零食']  (plain tag kept)
```
