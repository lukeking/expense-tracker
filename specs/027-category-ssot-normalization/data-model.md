# Data Model: Category SSOT Normalization

No schema changes. This feature redefines the **content conventions** of two existing `text[]` columns.

## Tag vocabulary

| Form | Meaning | Examples |
|---|---|---|
| `major:sub` (in catalog) | Category tag | `食:早餐`, `行:神盾` |
| `major` bare (in catalog) | Whole-major category tag | `食` *(selectable as 整體)* |
| `其他:未分類` (sentinel, **not** in catalog) | Explicit-uncategorized override — item-only | — |
| plain (no `:`) | Free tag (vendor, cross-cut) | `全家`, `訂閱` |

Category detection stays position-independent: `tags.find(t => t.includes(':'))`. Writes keep the B1 convention of category-first at tx level (`[category_tag, ...free_tags]`). The existing `tags[0]` reads (`ParentSearch.tsx:74,125`, `EntryScreen.tsx:369`) are **transaction-label fallbacks** (`note ?? item_names[0] ?? tags[0]`), not category derivation — they are out of FR-011's scope and need no change.

## Transaction (`transactions.tags`)

| State | Shape | Semantics |
|---|---|---|
| Categorized | `['食:雜貨', '全家', …]` | Authoritative default for the tx and all inheriting items |
| Uncategorized | `['全家', …]` (no `:`-tag) | Whole tx (minus overridden items) buckets to 其他 |

Invariants:
- **T1**: At most one `:`-tag (already enforced by write paths and the Discord parser).
- **T2**: The sentinel `其他:未分類` never appears at tx level (tx-level "uncategorized" = absence of a `:`-tag).

## Transaction Item (`transaction_items.tags`) — the three states

| State | Shape | Effective category | Set by | Removed by |
|---|---|---|---|---|
| **Inherit** (default) | no `:`-tag (plain tags allowed) | the tx's category, **live** — follows later tx changes | 繼承主分類 picker row / `category_tag: null` | n/a |
| **Override** | exactly one catalog `:`-tag ≠ tx category | its own tag, fixed | picking a category | 繼承主分類 |
| **Explicit-uncategorized** | exactly one sentinel tag `其他:未分類` | 其他 (a decision, not absence) | 設為「其他」 picker row | 繼承主分類 |

Invariants (post-write and post-migration, modulo guard-skipped txs):
- **I1**: An item never stores a `:`-tag equal to its transaction's current category (FR-013 collapse).
- **I2**: At most one `:`-tag per item.
- **I3**: Plain tags on items are independent of all category operations (preserved verbatim by merge/normalize/migration).
- **I4**: `⚠ 未分類` flag ⇔ item resolves to 其他 *by absence* (no item `:`-tag AND no tx `:`-tag). The sentinel does **not** flag — it renders as a normal 其他 assignment.

## Effective-category derivation (read-time, both backend aggregation and PWA display)

```
effectiveCategory(item, tx):
  itemTag = item.tags.find(includes ':')
  if itemTag == SENTINEL  → 其他            (source: explicit-uncategorized)
  if itemTag              → itemTag          (source: override)
  txTag = tx.tags.find(includes ':')
  if txTag                → txTag            (source: inherited)
  else                    → 其他             (source: none → ⚠ flag eligible)
```

Backend aggregation realizes this implicitly (item-tag buckets + remainder-to-tx-tag in `aggregateByCategory`); the PWA realizes it explicitly via `effectiveItemCategory()` in `lib/itemCategory.ts`. These two must agree — asserted by tests.

## Write normalization (applied at every item write)

```
normalizeItemTagsOnWrite(txCategoryTag, itemTags):
  keep all plain tags
  keep sentinel as-is
  drop a catalog :-tag if it equals txCategoryTag   // collapse → inherit
  keep a catalog :-tag if it differs                // override
```

Applied: PWA POST/PUT (per item), PWA item PATCH (on the incoming `category_tag`), Discord `/expense` item construction, Android ingest item construction, refund-link item (drops the parent-category copy; the refund **tx** keeps its snapshot copy).

Promotion (Android ingest + migration only): tx without a `:`-tag whose items all carry the **same** catalog `:`-tag → that tag moves to `tx.tags` (prepended) and the items collapse to inherit.

## One-off migration transform (per transaction)

```
1. before = aggregateByCategory([tx])               // bucket map
2. if tx has category:    strip item tags equal to it (→ inherit)
   elif items unanimous:  promote tag to tx.tags, strip from items
   else:                  no-op (mixed-category legacy stays as overrides)
   (sentinel/plain tags never touched; items keep I2/I3)
3. after = aggregateByCategory([tx'])
4. before ≠ after (any bucket) → SKIP + log         // total-preserving guard
5. else persist item/tx tag updates; NO transaction_edit_history rows
```

Run-level verification (FR-010 / SC-002): per-period per-category totals before vs after across the whole dataset must be identical; skipped-tx list reported for manual review (these remain correct via the remainder dedupe — FR-012).

## State transitions (item, via picker / PATCH)

```
              pick category X (≠ tx default)            pick X == tx default
  INHERIT ───────────────────────────────► OVERRIDE   ──────────┐
     ▲  ▲                                      │                 │ (collapse)
     │  └──────────── 繼承主分類 (null) ◄──────┘                 ▼
     │                                                        INHERIT
     │         設為「其他」 (sentinel)
     └─────────────────────────────► EXPLICIT-UNCATEGORIZED
                  繼承主分類 (null) ◄──────────┘
```

All transitions idempotent (re-applying the current state is a no-op; PATCH skips the edit-history row on no-change, as shipped in 026).
