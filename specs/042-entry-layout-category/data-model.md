# Data Model: Entry Fee/Refund Layout + Major-Category Selector

**Feature**: 042-entry-layout-category | **Date**: 2026-06-29

No persistent schema changes. This feature introduces **derived, in-memory view models only**. The database, category table, and all API payloads are unchanged.

## Derived: CategoryUsageRanking (new, in-memory, per session)

Computed by `useCategoryUsage` from recent transactions; memoized for the session.

| Field | Type | Description |
|---|---|---|
| `majorRank` | `string[]` | All majors ordered by usage count desc; ties broken by existing `sort_order` then name. Drives the top-N inline chips + 更多 order. |
| `subRank` | `Map<string, string[]>` | Per-major: sub-categories ordered by usage count desc, same tie-break. Drives sub-chip order + the sub-overflow sheet. |
| `hasData` | `boolean` | False when no usage could be derived (empty/new) → callers fall back to `useCategories` natural order. |

**Derivation rules**:
- Source: `/pwa/transactions` over a recent window (~180 days), fetched once (long `staleTime`).
- For each `TxRecord`: gather distinct colon-tags (`主:子`) from `tags` + `items[].tags`; a tag is a category iff its `主` part is in the `useCategories` major set.
- Count each transaction **once per distinct** `主` and once per distinct `主:子` it contains (presence-based, not occurrence-weighted).
- Majors/subs never seen still appear (appended in `sort_order`) so the full set stays selectable.

**Lifecycle**: Created on first entry-screen render; stable for the session; not persisted; not re-sorted when a new entry is added mid-session (D4).

## View model: LinkedOriginalCard (new shaping of existing data)

Presentation shape for `ParentSearch`'s linked state. **All fields already exist on `ParentSearchResult`** — no API/contract change.

| Display element | Source field | Notes |
|---|---|---|
| Title | `note ?? item_names[0] ?? tags[0] ?? id.slice(0,8)` | Existing fallback chain |
| Payment | `payment_method` | Rendered via existing payment label map |
| Category | `category` | May be `null` (ambiguous) → omit the segment |
| Amount | `amount` | `NT$` formatted |
| Date | `transaction_at` | Short `M/D` (or existing date format) |
| Clear control | — | ✕ → `onSelect(null)` (existing) |

## Unchanged entities (reference only)

- **CategoryRow** (`useCategories`): `{ major, subcategory, sort_order }` — unchanged; remains the source of the full category set and the fallback order.
- **ParentSearchResult** (`ParentSearch`): `{ id, amount, note, tags, transaction_at, item_names, payment_method, category }` — unchanged; already sufficient for the rich card.
- **TxRecord** (`useTransactions`): `{ …, tags, items[].tags, … }` — unchanged; read-only source for usage counting.

## State (entry forms — unchanged semantics)

Fee/Refund form state (`amount`, `paymentMethod`, `category`, `description`, `parent`, touched flags) is unchanged from spec 041. This feature only reorders where these render and how `parent` is displayed; the non-destructive, create-time auto-fill state machine is inherited as-is.
