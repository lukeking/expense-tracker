# Research: Transaction Items Table

## Decision 1: How to fetch items alongside transactions for summary

**Decision**: Use Supabase PostgREST nested select via the FK relationship — `.select('id, amount, tags, transaction_at, transaction_items(amount, tags)')` — fetched in a single round-trip.

**Rationale**: PostgREST automatically exposes FK-linked tables as nested arrays in the JSON response when the FK is declared. No view, no raw SQL, no second query needed. The existing `getTransactionsForPeriod` function gains one field in its select string. Supabase returns `transaction_items: [{amount, tags}]` nested inside each transaction row.

**Alternatives considered**:
- Two separate queries (transactions + items): works but wastes a round-trip on every `/summary` call
- Database view materialising the aggregation: over-engineered for a personal tool; adds a DB artifact to maintain

---

## Decision 2: Where category aggregation math lives

**Decision**: Client-side in `summary.ts`. `aggregateByCategory` receives items nested under each transaction and applies the partial-split rule:

```
for each transaction:
  categorisedTotal = sum(item.amount for item in items where item.amount != null and item has a category tag)
  uncategorisedRemainder = transaction.amount - categorisedTotal  (≥ 0)
  → each categorised item contributes item.amount to its category
  → remainder (if > 0) contributes to 其他
```

**Rationale**: No DB-side aggregation needed; the dataset for a single user over any period is small (hundreds to low thousands of rows). The client-side function already handles all the category/其他 logic — extending it is simpler than adding a SQL view or stored procedure.

**Alternatives considered**:
- SQL aggregation via GROUP BY in Supabase: would require raw SQL or a view, complicates the query layer
- Move to a database view: adds schema artifact, harder to iterate on the 其他 fallback logic

---

## Decision 3: Per-item category tag format in Discord expense-parser

**Decision**: Extend `parseDescription` so a comma-separated token that starts with `#category:subcategory` applies that tag to the item in the same token, not the whole transaction.

Input format (extended):
```
/expense 180 全家,#食:早餐 便當 60,#醫:藥 感冒藥 120
```
- `全家` → plain tag on the transaction
- `#食:早餐 便當 60` → item: name=便當, amount=60, tags=[食:早餐]
- `#醫:藥 感冒藥 120` → item: name=感冒藥, amount=120, tags=[醫:藥]

A bare `#食:早餐` token (no item following) still works as before — creates an implicit single-item from the subcategory name with the transaction total.

**Rationale**: Minimal syntax change. Backwards-compatible — single-category entries typed today still parse identically. The leading-`#` convention already exists; extending it to be item-scoped is the most natural extension.

**Alternatives considered**:
- Separate `tags` field per item in a multi-step wizard: violates Constitution IV (no multi-step wizard)
- JSON-like input syntax: too complex for quick Discord entry

---

## Decision 4: Transaction write pattern with items

**Decision**: Sequential insert — `insertTransaction` then `insertTransactionItems` as separate Supabase calls. No distributed transaction.

**Rationale**: The failure mode (transaction inserted, items failed) is tolerable — the transaction is still recorded at the correct total, just appears under 其他 in summary until items are re-entered. For a personal single-user tool this is acceptable. Adding a DB-level transaction wrapper would require moving to raw SQL or a Supabase RPC.

**Alternatives considered**:
- Supabase RPC / stored procedure that inserts both atomically: adds a DB artifact, harder to maintain
- Single upsert with nested items via PostgREST: not supported for inserts with nested related rows

---

## Decision 5: Fate of `transactions.items` JSONB column

**Decision**: Drop the column in the schema migration. Test data is being dropped anyway, so no data migration is needed.

**Rationale**: Keeping a dead JSONB column alongside the new FK table creates confusion and maintenance burden. Clean removal is possible given the fresh-start constraint.

**Alternatives considered**:
- Keep as a read cache: over-engineering for a personal tool; two sources of truth for item data
- Keep as legacy read path: unnecessary since all readers will be updated

---

## Decision 6: Android / Gemini items schema

**Decision**: Extend `GeminiParseResult.items` to add an optional `tags?: string[]` per item. The Android prompt rules gain a rule: a `#category:subcategory` token before an item name applies to that item.

**Rationale**: Mirrors the Discord parser extension (Decision 3). The JSON schema returned by Gemini is updated to include `tags` per item. The Gemini prompt explicitly instructs per-item tag assignment. Backwards-compatible — items without tags default to `[]`.

**Alternatives considered**:
- Keep transaction-level tags only for Android: loses the per-category benefit for Android-captured transactions — not acceptable if the goal is consistent summary accuracy across both entry paths

---

## Decision 7: `/amend` cascade strategy

**Decision**: On amount change, check item count and existing amounts:
- 1 item, item.amount == old transaction.amount → also update item.amount to new value
- Multiple items with amounts → warn user, do not cascade
- Items with no amounts → update transaction.amount only, no warning

**Rationale**: The single-item case (dominant) becomes zero-friction. The multi-item case surfaces the inconsistency explicitly rather than silently accepting wrong data.

**Alternatives considered**:
- Always cascade to all items proportionally: complex math, surprising behaviour for items with deliberate individual amounts
- Never cascade, always warn: adds friction to the 90%+ single-item case
