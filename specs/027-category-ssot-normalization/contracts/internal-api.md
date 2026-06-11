# Internal API Contract Changes: Category SSOT Normalization

All endpoints are internal (PWA ⇄ Worker, Android-key auth). No new endpoints; no breaking shape changes. Semantics extended on one endpoint; server-side write behavior changes on three.

## PATCH /pwa/transactions/:id/items/:itemId  *(extended semantics)*

Request body unchanged: `{ "category_tag": string | null }`

| `category_tag` value | New meaning |
|---|---|
| `null` | **Inherit** — remove the item's category tag; item follows the tx category (live) |
| `"其他:未分類"` (sentinel) | **Explicit-uncategorized** — stored verbatim; item buckets to 其他 |
| catalog tag ≠ tx category | **Override** — replaces the item's `:`-tag (unchanged from 026) |
| catalog tag = tx current category | **Collapsed to inherit** (FR-013): server stores nothing, identical to `null` |

- Plain tags always preserved (unchanged).
- Validation unchanged (`400 INVALID_PAYLOAD` / `INVALID_CATEGORY_TAG` on empty string, `404`, `403 NOT_EXPENSE`) — the sentinel passes the existing non-empty-string check by design.
- Edit-history row written only on effective change (collapse that results in no tag change writes none).
- **Response** unchanged: the updated item `{ id, name, amount, tags }`. The PWA derives display state from `tags` via `effectiveItemCategory`.

## POST /pwa/transactions  ·  PUT /pwa/transactions/:id  *(behavior change, same contract)*

Request bodies unchanged (`category_tag`, `free_tags`, `items[].tag`, …).

- Server no longer copies `category_tag` onto items that have no `tag` of their own (`items[].tag: null` → stored `tags` contain plain/note tags only — **inherit**).
- `items[].tag` equal to `category_tag` is collapsed to inherit (FR-013).
- `items[].tag` may be the sentinel (stored verbatim).
- `tx.tags` continues to be `[category_tag, ...free_tags]` when categorized (B1 convention, unchanged).

## GET endpoints  *(no change)*

`/pwa/transactions`, `/pwa/summary*`, `/pwa/import/matched` shapes unchanged. Consumers must treat an item without a `:`-tag as **inheriting** (was: ambiguous). Summary numbers are unaffected by construction (FR-008).

## Discord `POST /discord` `/expense` command  *(behavior change, same contract)*

Command syntax unchanged. The single shared category from `tags` (`#major:sub`) is now stored on the **transaction** (prepended); items no longer receive copies of it. Per-item `#cat name amount` description syntax still produces item-level tags — now stored only when different from the shared category. Reply embed rendering unchanged (it already displays `sharedCategory` separately).

## Android `POST /transactions` ingest  *(behavior change, same contract)*

Request unchanged. Server applies write normalization to Gemini-parsed item tags: unanimous item category with no tx category is promoted to the transaction; copies of the tx category are collapsed.
