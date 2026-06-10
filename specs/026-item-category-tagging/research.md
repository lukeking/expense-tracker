# Phase 0 Research: Usable item-level category assignment

All Technical Context items were resolvable from the existing codebase; no external research needed. The decisions below record the non-obvious choices.

## D1 — Write path for inline single-item categorization

**Decision**: Add a focused `PATCH /pwa/transactions/:id/items/:itemId` that updates one item's `tags`. Do **not** reuse the full-edit `PUT /pwa/transactions/:id`.

**Rationale**: `PUT` is a destructive whole-transaction rewrite — it requires `amount`, `payment_method`, the **full** `items[]` and `adjustments[]`, then `delete`s and re-`insert`s all items and recomputes `effective_amount` (`pwa.ts:438-548`). The three inline surfaces (import review, Summary list) do not hold the full item/adjustment set, and re-sending it to flip one tag is both heavy and risk-prone (could drop notes/amounts). A per-item PATCH mirrors the existing single-item helpers `updateTransactionItemAmount` / `renameTransactionItem` (`queries.ts:675-699`) and is the minimal change.

**Alternatives considered**:
- *Reuse `PUT`* — rejected: forces every caller to assemble the entire transaction; couples a one-tap action to the editor's payload.
- *Generic `PATCH /transaction_items/:id`* (no tx in path) — rejected: the tx id is needed for the 403-expense check and the audit-history row keyed by `transaction_id`; nesting under the tx keeps authorization/history natural.

## D2 — No `effective_amount` recompute on category change

**Decision**: The PATCH updates only `tags`; it leaves `amount` and `effective_amount` untouched.

**Rationale**: `effective_amount` is the discount-apportioned net share computed from face **amounts** (feature 025); it is independent of category tags. Re-running `computeAndWriteEffectiveAmounts` would be a no-op write. The aggregators read `item.effective_amount ?? item.amount` (`summary.ts:49,106`), so a freshly-tagged item is attributed at its existing net value immediately. This satisfies FR-012 ("assigning categories MUST NOT change amounts/net total").

## D3 — One shared picker component (`ItemCategorySheet`)

**Decision**: Extract a single searchable/major-filterable bottom sheet and reuse it from `ItemRow` (US1), `ImportScreen` (US2a), and `SummaryScreen` (US2b).

**Rationale**: All three need the identical interaction (find a `major:sub`, or inherit/clear). `CategoryPicker.tsx` already implements the chips-+-search idiom but returns a `{major, subcategory}` object for *transaction-level* selection and has no "inherit" affordance. Rather than fork `CategoryPicker` or duplicate the flat list three times, one focused `ItemCategorySheet` returning a tag **string | null** matches `ItemRow`'s existing `tagOverride` contract and keeps a single categorization UI. Under Constitution I this abstraction is justified by three real consumers (not speculative).

**Alternatives considered**:
- *Generalize `CategoryPicker` to serve both* — rejected: different return type + the "inherit/clear" option would bloat its API; the transaction picker is inline (chips on the form), the item picker is a modal sheet.
- *Duplicate the improved sheet per surface* — rejected: three copies to keep visually/behaviourally consistent.

## D4 — Record edit-history for inline category assignment

**Decision**: The PATCH writes a `transaction_edit_history` row (items-only diff) by reusing `readItemsForDiff` + `computeEditDiff` (`pwa.ts:346-386`).

**Rationale**: Every other content mutation (`PUT`) records an audit diff (feature 020). A category change is a content change to the user's financial record; omitting it would leave a silent-edit gap. The helpers already exist, so the cost is a before-read + a conditional insert. The diff is computed with identical header/adjustments so only the `items` delta is recorded.

**Alternatives considered**: *Skip history for inline edits* — rejected as an audit regression for marginal savings.

## D5 — Add item `id` to `/import/matched`, not a new read endpoint

**Decision**: Extend `getTransactionItemsByTransactionIds` to select `id` and include it in the `/import/matched` item mapping (`pwa.ts:924-928`). No new GET endpoint.

**Rationale**: The import review already fetches matched transactions' items; it just drops the `id` when mapping (`{name, amount, tags}`). The inline PATCH addresses an item by id, so the id must reach the client. The Summary surface already gets item `id` from `GET /transactions` (`pwa.ts:304,320`), so no change there.

## D6 — No historical backfill script

**Decision**: Do not ship a backfill (unlike feature 025's `effective_amount` script).

**Rationale**: 025 could *derive* the missing value (proportional share) deterministically. Here the missing value is a **category**, which cannot be inferred without name-based suggestion — and that (US3) was explicitly deferred by the user. The legacy backlog is instead made *reachable and one-tap fixable* from the Summary list (US2b). There is nothing to auto-populate.

## D7 — Tag-merge rule (preserve plain tags)

**Decision**: On assign, `newTags = tags.filter(t => !t.includes(':')) ++ (category_tag ? [category_tag] : [])`.

**Rationale**: An item may legitimately carry plain/context tags alongside its single category. Treating the `:`-containing tag as "the category" and rebuilding around it makes assign/reassign/clear idempotent and non-lossy. Matches how `summary.ts` already identifies an item's category (`tags.find(t => t.includes(':'))`).
