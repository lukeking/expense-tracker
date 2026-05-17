# Data Model: Transaction Items Table

## Schema Changes

### New Table: `transaction_items`

```sql
CREATE TABLE transaction_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID        NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  amount          INTEGER     NULL,          -- null = unknown, filled later via invoice/edit
  tags            TEXT[]      NOT NULL DEFAULT '{}',  -- category:subcategory tags for this item
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transaction_items_transaction_id ON transaction_items (transaction_id);
```

**Constraints**:
- `amount` must be > 0 when not null (enforced at application layer)
- `ON DELETE CASCADE` — deleting a transaction removes all its items automatically
- No DB-level constraint on `SUM(items.amount) = transactions.amount` — partial splits are valid

---

### Modified Table: `transactions`

**Drop column**: `items JSONB` — removed entirely (no migration needed; test data dropped)

**Column `tags TEXT[]`**: Retained but semantics narrowed. After this feature, `tags` holds only transaction-level context:
- Store/merchant name (e.g. `全家`, `Uber Eats`)
- Payment context or plain descriptors
- Discord/source context tags

Category tags (`食:午餐`, `醫:藥`) MUST NOT be stored on `transactions.tags` after this change. They live exclusively on `transaction_items.tags`.

---

## Entity Relationships

```
transactions (1) ──── (0..*) transaction_items
     │
     └── amount          (total paid — always set)
     └── tags            (store name, plain context tags — no category tags)
     └── payment_method  (how it was paid)
     └── transaction_at  (when it happened)
     └── transaction_type (expense / refund / fee)

transaction_items
     └── transaction_id  (FK → transactions.id)
     └── name            (item description)
     └── amount          (nullable — this item's share of the total)
     └── tags            (category:subcategory tags for this item)
     └── sort_order      (display order)
```

---

## Summary Aggregation Logic

The summary function receives transactions with nested items. For each transaction:

```
categorised_items = items where (amount IS NOT NULL AND tags contains a 'X:Y' tag)
categorised_total = SUM(categorised_items.amount)
remainder         = transaction.amount - categorised_total  (≥ 0 by validation)

→ Each categorised item contributes item.amount under tags[0].split(':')[0]
→ remainder contributes to '其他'
→ If no items or all items have no amounts: full transaction.amount → '其他'
```

---

## TypeScript Type Changes

### Updated `GeminiParseResult` (types.ts)

```typescript
// Before
export interface GeminiParseResult {
  amount: number;
  payment_method: PaymentMethod;
  items: { name: string; amount?: number }[];
  tags: string[];
}

// After
export interface GeminiParseResult {
  amount: number;
  payment_method: PaymentMethod;
  items: { name: string; amount?: number; tags?: string[] }[];
  tags: string[];  // transaction-level only (store name, plain tags)
}
```

### New `TransactionItem` (types.ts)

```typescript
// Replaces the JSONB-embedded TransactionItem used by Transaction.items
export interface TransactionItemRow {
  id: string;
  transaction_id: string;
  name: string;
  amount: number | null;
  tags: string[];
  sort_order: number;
  created_at: string;
}
```

### Updated `Transaction` (types.ts)

```typescript
// Remove: items: TransactionItem[] | null
// The items field is dropped from the Transaction interface entirely;
// items are fetched separately via transaction_items table
```

---

## Validation Rules

| Rule | Where enforced |
|------|---------------|
| `item.amount > 0` when not null | Application layer (before insert) |
| `SUM(item.amount) ≤ transaction.amount` when all amounts present | Application layer (warn on >) |
| At least one of `name` or `tags` must be non-empty | Application layer |
| `transaction_id` must reference an existing transaction | DB FK constraint |
| Cascade delete: items deleted when parent transaction deleted | DB ON DELETE CASCADE |

---

## State Transitions

```
Transaction created (amount known)
    │
    ├─ with item amounts → summary correct immediately
    │      (SUM(items.amount) = transaction.amount or partial)
    │
    └─ without item amounts → summary shows '其他' for full amount
           │
           └─ invoice imported and matched
                  │
                  └─ item amounts populated → summary correct
```
