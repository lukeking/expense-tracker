# Phase 0 Research: 連結原始交易 auto-fill

**Feature**: 041-parent-autofill | **Date**: 2026-06-28

All spec-level `[NEEDS CLARIFICATION]` were resolved with the user before planning (see spec.md / checklist). This file records the *technical* decisions for implementation.

## D1 — Where a transaction's category lives, and how to derive a single one

**Decision**: A category is a tag of the `主:子` shape — identified by `tag.includes(':')` (free/plain tags have no colon). The single category for auto-fill = the **distinct set** of colon-tags across `transaction.tags` + every `transaction_item.tags`; if that set has **exactly one** member, use it, otherwise `null`.

**Rationale**:
- Per feature 027 "B2" (`backend/src/handlers/pwa.ts` POST `/pwa/expense`, ~L211): *the transaction-level category is the SSOT* — it is written as `tags[0]` (the `category_tag`), and items inherit it via `itemWriteTags`. So a PWA-created expense (or a fee) has exactly one distinct colon-tag → resolves cleanly.
- A legacy/imported expense with items in different categories yields a distinct set > 1 → `null`, which is exactly the spec's "leave the category for the user when ambiguous" (FR-004, user-confirmed "only if exactly one category").
- The codebase already finds a transaction's category this way: `enrichRefundTags` (pwa.ts ~L61) does `[...parent.tags, ...parent.transaction_items.flatMap(i => i.tags)].find(t => t.includes(':'))`. We mirror it but use a distinct-set/size-1 test instead of `.find` to honor the "exactly one" rule.

**Alternatives considered**:
- *First colon-tag (`.find`), like `enrichRefundTags`*: simpler, and identical for B2 data — but on legacy multi-category items it would silently pick one category, contradicting the user's "only if exactly one" decision. Rejected.
- *Largest line-item's category*: the user explicitly rejected this option. Rejected.
- *A new derived DB column / view for "transaction category"*: violates "no DB change" and Simplicity-First; the tags already encode it. Rejected.

## D2 — Surfacing payment_method + category through parent-search (no DB/endpoint change)

**Decision**: Extend the existing `GET /pwa/parent-search` read path only. In `findParentCandidates` (`backend/src/db/queries.ts`), add `payment_method` to the `.select(...)` (it is a transaction column) and compute the resolved category (D1) per candidate. In the handler mapping (`pwa.ts` ~L686), include `payment_method` and `category` on each returned object. `amount` (needed for 全額退款) is already returned.

**Rationale**: One projection field + one in-code derivation over the ≤5 candidates already fetched. No new endpoint, no new query param, no DB migration — matches how feature 030 added `effective_amount` (one projection line). Keeps the boundary and billing footprint unchanged (Constitution III).

**Alternatives considered**:
- *A separate `/pwa/parent/:id` detail fetch on select*: an extra round-trip + a new endpoint for data we already have in hand at search time. Rejected (Simplicity-First, perf).
- *Derive category on the client from the returned tags*: would require returning item-level tags to the client and duplicating the resolution rule in the PWA; cleaner to resolve once, server-side, near the data. Rejected.

## D3 — Non-destructive, create-time-only auto-fill ("touched" model)

**Decision**: Each auto-fillable field gets a "touched" flag in form state, set when the user changes that field by hand. On parent select (including re-link to a different original), auto-fill writes **only** fields whose touched flag is `false`. Description keeps its existing *fill-when-empty* rule (equivalent to "untouched"). Clearing the link changes nothing. Nothing runs after submit — auto-fill is purely a compose-time helper; the saved row keeps only `parent_transaction_id`.

**Rationale**: Directly implements the user-confirmed FR-003/FR-009 ("keep my manual choice"; create-time only). Payment method always has a value (defaults to `credit_card`), so "fill only if empty" is meaningless for it — a touched flag is the correct mechanism. Mirrors the existing fee-description behavior (`if (result && !description.trim())`), generalized.

**Alternatives considered**:
- *Always overwrite on (re-)link*: simpler but discards user edits — explicitly rejected by the user. Rejected.
- *Infer "untouched" by comparing to default*: fragile for category (no natural default) and ambiguous when the user intentionally re-selects the default. An explicit touched flag is unambiguous. Rejected.

## D4 — 全額退款 (full-refund) one-tap, refund-only

**Decision**: Add a 「全額退款」 control to `RefundForm`, rendered only when a parent is linked. Tapping it sets the amount input to `parent.amount` (the full original amount, already in `ParentSearchResult`). The amount stays editable afterward; tapping does not lock or re-apply. Not present on the fee form.

**Rationale**: The user asked for exactly this. The full amount is the right value only for a full refund, so it is an explicit one-tap action rather than a default auto-fill (the amount is otherwise never auto-filled, FR-007). It needs a linked original (that is where the amount comes from), so it is gated on `parent != null`.

**Alternatives considered**:
- *Auto-fill amount to the parent total by default*: wrong for the common partial-refund case; rejected by the user. Rejected.
- *Show 全額退款 always (disabled until linked)*: extra disabled affordance with no value; hiding until a parent is linked is cleaner. Rejected.

## D5 — Testing strategy

**Decision**:
- **Backend (has a unit harness)**: unit-test the pure `resolveSingleCategory` helper (one category → that tag; multiple distinct → `null`; none → `null`; tx-level + inherited item tags → the one tag). Extend the existing `/pwa/parent-search` Vitest worker test to assert each returned candidate carries `payment_method` and the resolved `category`.
- **PWA (no unit harness)**: TypeScript typecheck (`tsc -b`) covers the new `ParentSearchResult` fields and form wiring; the i18n parity guard (`pnpm i18n:check`, zh = en) covers the new `entry.fullRefund` key.
- **E2E (optional)**: a Playwright smoke — seed/stub a parent, link it on the fee tab (assert payment pill + category pre-fill), and on the refund tab tap 全額退款 (assert amount = parent total; assert a manually-changed field survives re-link).
- **Manual**: verify against the `quickstart.md` mockup (single-category vs. multi-category parent; touched-field survival; clear/​re-link).

**Rationale**: Matches the repo's actual harnesses (Constitution Quality Standards mandate Vitest worker tests for handlers; the PWA relies on tsc + i18n parity + E2E, as established in feature 030). The category-resolution helper is the one piece of non-trivial logic, so it gets a focused unit test.
