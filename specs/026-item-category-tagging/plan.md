# Implementation Plan: Usable item-level category assignment

**Branch**: `026-item-category-tagging` | **Date**: 2026-06-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/026-item-category-tagging/spec.md`

## Summary

Two deterministic improvements to **item-level** categorization (no LLM, no name-based suggestion — deferred per the 2026-06-09 clarification):

1. **US1 — usable per-item category picker.** `ItemRow`'s tag sheet renders one flat, ungrouped list of every major + every `major:sub` value (`ItemRow.tsx:62-68,160-169`). Replace it with a searchable, major-filterable bottom sheet — the same chips-+-search idiom `CategoryPicker` already uses for transaction-level selection — extracted as **one shared component** so all three Story-2 surfaces reuse it.
2. **US2 — uncategorized items don't vanish into 其他.** Invoice fills create items with `tags: []` (`invoice-matcher.ts:146,296`); `aggregateByCategory` (`summary.ts:48-63`) then dumps their spend into the transaction-level fallback (`其他` when only a plain tag like `全家` exists). Surface each item's category + an "未分類" flag and an **inline tap-to-assign** on two surfaces — the import review (`ImportScreen`) and the Summary transaction list (`SummaryScreen`) — plus the existing editor as fallback. Inline assignment is backed by a new focused `PATCH /pwa/transactions/:id/items/:itemId` that sets a single item's category tag.

**No schema change** (`transaction_items.tags` already exists). **No `effective_amount` recompute** — assigning a category changes only which bucket the spend counts under, not amounts (FR-012); the aggregators already prefer `effective_amount ?? amount`, so a categorized item self-attributes immediately. **No new read-side API contract** except adding item `id` to the existing `/import/matched` items (needed to address an item for the inline PATCH).

## Technical Context

**Language/Version**: TypeScript (ES2022), Node toolchain via pnpm
**Primary Dependencies**: Hono (router), `@supabase/supabase-js` (PostgREST client), Vitest + `@cloudflare/vitest-pool-workers`; PWA: React + `@tanstack/react-query` (no Recharts change)
**Storage**: Supabase Postgres — `transaction_items(tags, …)` only; no DDL
**Testing**: Vitest workers pool (Miniflare) for backend handlers/queries + pure aggregation tests with an in-memory fake Supabase. **PWA has no test runner** → UI validated via quickstart (consistent with feature 025).
**Target Platform**: Cloudflare Workers (single isolate/request) + static PWA
**Project Type**: Web app — backend Worker + PWA frontend (this feature touches both)
**Performance Goals**: The new PATCH is a single bounded write (1 read + 1 update + ≤1 history insert); not in the import pipeline, so feature-024's subrequest budget is untouched.
**Constraints**: CF Workers subrequest cap / 128 MB — trivially satisfied (per-item endpoint, no batch). PWA picker must stay usable against the full catalog (the point of US1).
**Scale/Scope**: Single user; the Summary inline-assign is sized to clear a historical backlog of legacy-migration items currently in 其他.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First** — Reuses the existing `CategoryPicker` chips-+-search idiom rather than inventing a new picker; the one new abstraction (a shared `ItemCategorySheet`) is justified because it is reused verbatim by three call sites (DRY, not speculative). One focused endpoint + one query helper; no new service/component beyond the shared sheet. No multi-user patterns.
- [x] **II. Offline-First on Android** — N/A; no Android code touched.
- [x] **III. Serverless Boundary Compliance** — The PATCH does a single small read+update (+ optional history insert), far inside limits; it is a synchronous PWA API call, not a Discord/Gemini deferred path. The `/import/matched` change adds only the `id` column to an existing select — zero extra queries.
- [x] **IV. Automation Over Manual Input** — No change to auto-capture or auto-matching. This corrects how already-captured spend is *categorized*; it adds no manual step to the capture flow. (The automation alternative — name-based suggestion — was explicitly deferred by the user; documented in spec Assumptions.)
- [x] **V. Security at System Boundaries** — No new secret/boundary. The PATCH lives behind the existing PWA API-key auth on `pwaRouter`; the service role stays server-side; no Android/Supabase direct path introduced.

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/026-item-category-tagging/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (write path, shared sheet, no-recompute, audit-history, backfill scope)
├── data-model.md        # Phase 1 — touched columns (no DDL) + the "uncategorized" predicate & tag-merge invariant
├── quickstart.md        # Phase 1 — how to validate (backend tests + manual PWA walkthrough)
├── contracts/
│   └── internal-api.md  # Phase 1 — new PATCH contract + the /import/matched item.id addition
└── tasks.md             # Phase 2 — /speckit-tasks output
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── db/
│   │   └── queries.ts            # ADD updateTransactionItemTags(itemId, tags);
│   │                             #   ADD `id` to getTransactionItemsByTransactionIds select + Pick type
│   └── handlers/
│       └── pwa.ts                # ADD PATCH /transactions/:id/items/:itemId (validate, merge tags,
│                                 #   update, record edit-history); ADD item.id to /import/matched mapping
└── tests/
    ├── db/queries.test.ts                  # updateTransactionItemTags; matched-items select shape (id present)
    ├── handlers/pwa-item-category.test.ts  # NEW: PATCH assign/reassign/clear, preserves plain tags,
    │                                       #   records history, 404 on bad id, 403 on non-expense
    └── services/summary.test.ts            # regression: assigning a category moves item spend out of 其他

pwa/
├── src/
│   ├── components/
│   │   ├── ItemCategorySheet.tsx # NEW shared sheet: search (type-ahead) + major filter chips +
│   │   │                         #   sub chips + 繼承/清除; returns a category tag string | null
│   │   └── ItemRow.tsx           # US1: replace inline flat tag sheet with <ItemCategorySheet>
│   ├── screens/
│   │   ├── ImportScreen.tsx      # US2(a): show item category + 未分類 flag in 交易品項; tap → sheet → PATCH
│   │   └── SummaryScreen.tsx     # US2(b): same in the transaction list (TxEntry items)
│   ├── api/
│   │   └── client.ts             # ADD assignItemCategory(txId, itemId, categoryTag) → PATCH
│   └── lib/                      # ADD isItemUncategorized(item, tx) shared predicate (small util)
```

**Structure Decision**: Existing web-app layout. Backend gains one query + one endpoint; the PWA gains one shared component reused by three call sites + small wiring. No migration, no Android, no Recharts/summary-shape change.

## Implementation Approach

### US1 — searchable / major-filterable item picker (P1, foundational)

- Extract `ItemCategorySheet.tsx` from the chips-+-search idiom in `CategoryPicker.tsx`: a `BottomSheet` with (1) a search input that type-ahead filters across `major` and `major:sub`, (2) horizontally-scrollable major filter chips, (3) subcategory chips for the selected major, (4) a "繼承主分類 / 清除" row. It takes `{ value: string|null, inheritedTag: string|null, extraTags: string[], onSelect(tag|null) }` and returns a single category tag string (or null = inherit/clear) — matching `ItemRow`'s existing `tagOverride` contract.
- `ItemRow.tsx`: delete the flat `allTagOptions` list (lines 62-68, 160-169) and render `<ItemCategorySheet>` instead. `extraTags` still feeds in already-present off-catalog tags (FR-005). EntryScreen + EditExpenseSheet inherit the improvement automatically (both render `ItemRow`).

### US2 — surface + inline-assign uncategorized items (P2)

**Shared predicate (FR-007).** `isItemUncategorized(item, tx)` = item has no tag containing `:` **and** `tx.tags` has no tag containing `:` to inherit. Used by both UI surfaces to drive the "未分類" flag.

**Write path (new endpoint).** `PATCH /pwa/transactions/:id/items/:itemId` body `{ category_tag: string | null }`:
- 404 if tx/item missing; 403 if tx is not an `expense` (mirror `PUT`).
- Read the item's current `tags`; rebuild as `[...plainTags, ...(category_tag ? [category_tag] : [])]` where `plainTags = tags.filter(t => !t.includes(':'))` — preserves store/context tags, replaces/sets/clears the single category tag.
- Persist via new `updateTransactionItemTags(itemId, newTags)`; **no** `effective_amount` recompute (amounts unchanged).
- Record a minimal edit-history entry by reusing `readItemsForDiff` + `computeEditDiff` (header/adjustments identical, only items differ) so the audit trail stays complete (consistency with `PUT`/feature 020).

**US2(a) import review (`ImportScreen.tsx`).** Add item `id` to the `/import/matched` items (backend: select `id` in `getTransactionItemsByTransactionIds`, include it at `pwa.ts:927`). In the 交易品項 list, show `#major:sub` (already partially done at line 393-396) or a `⚠ 未分類` flag when `isItemUncategorized`; tapping a row opens `ItemCategorySheet`; on select call `assignItemCategory` and update local state so the flag clears.

**US2(b) Summary list (`SummaryScreen.tsx`).** The transaction list already renders items with id+tags from `GET /transactions`. In the item line (`SummaryScreen.tsx:95-98`), add the category / `未分類` flag and make it tappable → `ItemCategorySheet` → `assignItemCategory` → invalidate the summary + transactions queries so the moved spend re-aggregates.

**Aggregation (FR-010/011) — no code change.** `aggregateByCategory` already counts `item.effective_amount ?? item.amount` under the item's `:` tag and routes the uncovered remainder to the tx-level fallback (其他). So each newly-assigned item moves from 其他 to its category automatically; uncategorized siblings stay in 其他. Covered by a regression test.

### Edge cases (from spec)

- **Off-catalog existing tag** (FR-005): `extraTags` keeps it selectable in the sheet; the PATCH stores whatever tag is chosen (no catalog enforcement, matching `PUT`).
- **Null-amount item**: categorization still allowed; attribution follows existing `?? amount` / remainder rules.
- **Inherited category** (`全家` + `飲食:超商`): `isItemUncategorized` returns false → no flag.
- **Discounted tx (025)**: `effective_amount` already set and untouched by the tag change → categorized item counts its net share.
- **Backlog**: legacy items are reachable from the Summary list (US2(b)); no backfill script — categories require human choice (US3 deferred), so there is nothing to auto-populate.

## Complexity Tracking

No constitution violations; table intentionally omitted.
