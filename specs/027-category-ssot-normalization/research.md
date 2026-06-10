# Phase 0 Research: Category SSOT Normalization

All unknowns from Technical Context resolved. Decisions below were validated against the live code (line references current as of branch point `18d189f`).

## D1. Representation of "explicitly uncategorized"

**Decision**: A reserved sentinel category tag, constant `EXPLICIT_UNCATEGORIZED = '其他:未分類'`, defined once in `backend/src/services/item-category.ts` and once in `pwa/src/lib/itemCategory.ts`. Item-only — never valid at transaction level.

**Rationale**:
- It must be a real `:`-containing tag: `aggregateByCategory` (summary.ts:51-56) buckets items **only** by their own `:`-tag; an untagged item falls into the remainder, which inherits the tx-level category (summary.ts:57-64). An untagged item therefore *cannot* represent "deliberately 其他" — it would inherit. A `:`-tag whose major parses to `其他` buckets correctly with **zero aggregation changes**: `'其他:未分類'.split(':')[0] === '其他'`.
- Drill-down (`aggregateBySubcategory`) shows it as subcategory `未分類` under 其他 — distinguishable from the passive no-category remainder (which lands in sub `其他`), which is honest: one is a decision, the other is absence.
- Not in the catalog (verified: `seed/categories.md` has no `其他 | 未分類` row) and must be **kept out** of the catalog so it only ever enters data through the dedicated picker action. Must also be excluded from the picker's searchable options and from `extraTags` rendering.

**Alternatives considered**:
- `其他:其他` — buckets identically and merges with the passive remainder in drill-down; rejected: indistinguishable from absence in reports, and `#其他:其他` reads as a glitch when displayed raw.
- A dedicated DB column / boolean on `transaction_items` — cleanest semantically; rejected: schema migration + every read/write/type touched, violating Simplicity-First for a single-user tool when a tag-space sentinel costs nothing.

## D2. One shared write-normalization rule

**Decision**: A pure helper in `backend/src/services/item-category.ts`:

```
normalizeItemTagsOnWrite(txCategoryTag: string | null, itemTags: string[]): string[]
```

Strips an item's category tag when it equals `txCategoryTag` (FR-013 collapse); preserves plain tags and genuine overrides; never touches the sentinel. Applied at **all four** backend write paths:

| Write path | Today | Change |
|---|---|---|
| PWA `POST /pwa/transactions` (pwa.ts:190) | `item.tag ?? copy of category_tag` onto each item | `item.tag` only, collapsed if equal to `category_tag` |
| PWA `PUT /pwa/transactions/:id` (pwa.ts:520) | same copy pattern | same fix |
| PWA `PATCH …/items/:itemId` (pwa.ts:575-599) | `mergeItemCategoryTag` replaces/clears | + collapse: incoming tag equal to tx category → treated as `null` (inherit); sentinel passes through |
| Discord `/expense` (discord.ts:160-170 + expense-parser.ts `parseItems`) | `sharedCategory` copied onto **items**; tx gets plain tags only — the inverse-shape factory | `sharedCategory` written to **tx.tags** (prepended, B1 convention); items keep only their own explicit `#cat` from the description, collapsed if equal |
| Android ingest (android.ts:168-184, Gemini-parsed) | tx gets `parsed.tags`, items get `i.tags` verbatim | items normalized against the tx category; unanimous item category with no tx category → promoted to tx.tags (same rule as migration) |

Refund-link path (pwa.ts:746-765): the **tx-level** parent-category snapshot (L755) stays — spec keeps cross-transaction inheritance as snapshot — but the **item** copy (L765) is dropped; the item inherits from its own transaction. `enrichRefundTags` (pwa.ts:53-65) is read-time and unchanged.

Invoice import-fill (pwa.ts:1280) already writes `tags: []` — already normalized; no change.

**Rationale**: One rule, one test surface, FR-003 + FR-013 enforced uniformly; prevents new denormalized data from any entry point after the migration runs.

**Alternatives considered**: per-handler inline fixes (rejected: five divergent copies of the same rule — exactly how B1's inconsistency happened); DB trigger (rejected: logic invisible to tests and to the Workers codebase).

## D3. Migration mechanism & safety

**Decision**: One-off local script `backend/scripts/normalize-category-ssot.ts` (pattern: `migrate-legacy.ts`; env-loaded Supabase service key; **dry-run by default**, `--apply` to write). Per transaction:

1. Compute the tx's `aggregateByCategory` contribution **before** the transform.
2. Transform: strip item tags equal to the tx category; if tx has no category and all items share one tag → promote it to tx.tags and strip (FR-009 unanimous promotion); sentinel and plain tags untouched; mixed-category stays as-is.
3. Recompute the contribution **after**. Any bucket differs → **skip the tx entirely**, log it, leave data untouched (total-preserving guard).
4. Report: per-period per-category totals before/after (must be identical — FR-010/SC-002 evidence) + list of skipped txs.

**No `transaction_edit_history` rows** are written — this is a representation change, not a user edit; flooding history would bury real edits.

**Rationale for the guard**: stripping can shift totals in one pathological shape — item amounts exceeding `tx.amount` (negative remainder is dropped by summary.ts:58, but item-tagged amounts are counted in full). Believed rare-to-absent in real data, but the guard makes FR-008/SC-002 *unconditionally* true rather than probabilistically: any tx where normalization would change buckets simply keeps its old (still-correct, remainder-deduped) shape. SC-003's "zero redundant copies" is then "zero, minus explicitly reported exceptions" — the report makes them visible for manual review.

**Alternatives considered**: SQL migration file (rejected: per project convention the live DB is the SSOT and migrations are seed-only — memory `project_categories_db_managed`); in-Worker endpoint (rejected: Principle III CPU limits, and a destructive op shouldn't be an HTTP call).

## D4. Read paths stay untouched

**Decision**: `summary.ts` is **not modified**. Its remainder logic already implements live inheritance (untagged item → remainder → tx-level tag → bucket) and already dedupes the legacy copied shape (item counted by its own tag, remainder shrinks accordingly). This single property is what makes mixed-era reads correct (FR-012) and makes the migration's before/after equivalence provable. New backend tests assert old-shape vs normalized-shape equivalence explicitly.

`aggregateBySubcategory`'s item-tag fallback (summary.ts:124-131) keeps un-promoted (mixed-category, guard-skipped) legacy txs drilling down correctly.

## D5. PWA effective-category derivation & display

**Decision**: Extend `pwa/src/lib/itemCategory.ts`:

- `effectiveItemCategory(item, tx): { tag: string | null; source: 'override' | 'explicit-uncategorized' | 'inherited' | 'none' }` — item's own `:`-tag (sentinel → `explicit-uncategorized`) else tx's `:`-tag (`inherited`) else `none`.
- `isItemUncategorized` keeps its semantics (no decision anywhere → ⚠ flag) — the sentinel counts as **categorized** (a decision was made), so explicit-其他 items show a normal `其他` chip, not the warning.

Surfaces (ItemRow, SummaryScreen item line L59/L70, ImportScreen L275/L436, EntryScreen) render from this one helper; inherited categories display de-emphasized (visual treatment finalized in the quickstart mockup). `EditExpenseSheet` keeps its dual-source read (`items ?? tx.tags`, L97) because guard-skipped and pre-migration data may still carry item copies (FR-012).

## D6. Picker contract (FR-014)

**Decision**: `ItemCategorySheet` `onSelect` widens from `string | null` to `string | null` **where the sentinel constant is a valid string value**; the single ✕ row (L74-85) is replaced by two rows: 繼承主分類（{tx category}）→ `onSelect(null)`, and 設為「其他」 → `onSelect(EXPLICIT_UNCATEGORIZED)`. When the tx has no category the inherit row reads 不分類（跟隨主分類） with the same `null` semantics. Sentinel excluded from search results and from `extraTags` chips. ASCII mockup in quickstart.md §4 — **requires Luke's sign-off before implementation** (standing preference).

## D7. Rollout order

**Decision**: (1) merge + auto-deploy code (reads tolerate both shapes; writes stop producing copies), (2) `--dry-run` the script against live DB and review the report, (3) `--apply`, (4) keep the script's verification output with the feature docs. No feature flag needed — every intermediate state is read-correct by D4.
