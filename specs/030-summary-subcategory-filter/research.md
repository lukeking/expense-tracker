# Phase 0 Research: Summary Subcategory Filter

All decisions below are grounded in the current code: `pwa/src/screens/SummaryScreen.tsx`, `pwa/src/hooks/useSummary.ts`, and `backend/src/services/summary.ts` (`aggregateBySubcategory`) / `backend/src/handlers/pwa.ts` (`GET /pwa/transactions`).

---

## D1 — Filter and sum amounts client-side; enrich the payload with `effective_amount`

**Decision**: When a subcategory is selected, filter the **already-loaded** major-category transaction list (`useTransactions(timeBase, offset, drilldown, tag, paymentMethod)`) in memory, and compute subcategory amounts client-side. Do **not** add a new server query or parameter. The **one** backend change is adding the already-stored `effective_amount` column to the `GET /pwa/transactions` `transaction_items(...)` projection, so the PWA has the net per-item figure it needs (D3).

**Rationale**:
- The drilldown already fetches the full major-category list; the subcategory is a strict subset of rows already on the client. An `Array.filter` + sum is instant — no second round-trip, no spinner, no flicker.
- The server `GET /pwa/transactions?category=X` predicate is `tags.some(t => t === X || t.startsWith(X + ':'))`. Passing `Major:Sub` works for normal subcategories **but misses the `其他` bucket** (bare-major-tagged items never match `t === 'Major:其他'`). Client-side filtering reproduces the bucket correctly (D2).
- The compute load is trivial (filter + sum over a few hundred in-memory rows). The reason amounts were previously inexact was **missing data**, not load: `effective_amount` (net of discounts/adjustments) is a persisted column the summary path already reads but `/pwa/transactions` did not project. Adding it is a one-token select change; the alternative of a new aggregation endpoint is more surface for no benefit.

**Alternatives considered**:
- *Server refetch with `category=Major:Sub`*: rejected — breaks the `其他` bucket, adds a fetch + loading state per tap.
- *New backend endpoint returning per-subcategory transaction contributions*: rejected — heavier than projecting one existing column; the PWA can sum `effective_amount` itself.
- *Compute amounts from raw item `amount` (no payload change)*: rejected — ignores discounts/adjustments, so totals would be gross, not net.

---

## D2 — Subcategory membership predicate (incl. the `其他` bucket)

**Decision**: Over the rows of the major-category list (every row already belongs to major `M`), a transaction belongs to selected subcategory `S` when, across its tx-level tags and all item tags:

```
function txInSubcategory(tx, major, sub):
  const tags = [...tx.tags, ...tx.items.flatMap(i => i.tags)]
  if (sub === '其他')
    // bare-major tags (no specific subcategory) are what the bar buckets into 其他
    return tags.some(t => t === major)
  return tags.some(t => t === `${major}:${sub}` || t.startsWith(`${major}:${sub}:`))
```

**Rationale**:
- Mirrors the server's major-level predicate (`t === X || startsWith(X + ':')`) one level deeper, so the subcategory filter is semantically consistent with how the drilldown list itself was selected.
- The `其他` branch matches the dominant `其他` source within a normal major — items/txns carrying only the bare-major tag — which is exactly what `aggregateBySubcategory` maps to `其他` (`categoryTag.split(':').slice(1).join(':') || '其他'`, and the remainder/`anyMatch` fallbacks).
- Categories are effectively two levels in this app, so the `startsWith(`${major}:${sub}:`)` arm is defensive; exact match dominates.

**Edge note (drilling into the top-level `其他` major)**: when `M === '其他'`, `aggregateBySubcategory` additionally buckets items with **no** `:` tag into `其他`. The predicate's `sub === '其他'` branch (`tags.some(t => t === '其他')`) plus the fact that the row is already in the `其他`-major list keeps this consistent for the common case; any divergence is the cross-subcategory approximation of D3, not a new class of bug.

---

## D3 — Net-amount reconciliation via `effective_amount` (the two user goals)

**Decision**: Compute every subcategory amount — the header period total and each day's subtotal — as the **sum of the matching items' `effective_amount`** (the net-of-discount per-item figure now in the payload, D1). The filtered list is day-grouped (Goal 1, which days). The header total is this client-computed net sum (Goal 2, how much), which equals the bar for item-tagged spend. A transaction whose items span multiple subcategories of the same major contributes only its matching items' net amount to each — so day subtotals and the total reconcile.

**Rationale**:
- The bar totals come from `aggregateBySubcategory`, which sums `item.effective_amount` per subcategory (plus a remainder/fallback path). Summing the same `effective_amount` client-side reproduces it for item-tagged spend.
- Using `effective_amount` (not raw `amount`) means discounts/adjustments are already netted — the user's "how much did I spend" answer is the true net.
- Day-grouping is already how the list renders (`HistoryGroup`/`DateSubGroup`); filtering to the subcategory directly answers "which days."

**The one residual divergence**: a transaction tagged **only at the transaction level** (no item carries the `Major:Sub` tag) is apportioned by the bar via the remainder/`anyMatch` rule (`summary.ts:122–134`). The PWA does **not** re-implement that rule (it would duplicate fragile backend logic). Such transactions — rare in this app, which tags at item level (feature 026) — may diverge slightly from the bar.

**Alternatives considered**:
- *Source the header total from the bar array instead of computing it*: viable, but computing it from the same rows shown keeps the headline self-consistent with the day subtotals; for item-tagged spend the two agree anyway.
- *Re-implement the remainder/fallback apportionment client-side for exactness*: rejected — duplicates backend logic for a rare case (Constitution I).

**Spec impact**: FR-005 / SC-002 hold exactly for item-tagged spend and the `其他` bucket; transaction-level-only tags are the documented edge.

**Correction (implementation, 2026-06-18)**: this decision's premise — that item-level tagging dominates and tx-level-only is a *rare* edge — was wrong. Under feature 027 (B2) the tx-level category is the source of truth and items **inherit** it (most items carry no own `major:` tag), so the "tx-level-only" case is the **common** case. Computing from matching item tags alone returned **NT$0** for nearly every real transaction. `subAmount` was therefore changed to a **faithful port of `aggregateBySubcategory`** (matched items + remainder/fallback), so amounts reconcile with the bar for all cases. The remaining edge is now only the displayed per-item breakdown in rare mixed-tag transactions (the row total is authoritative).

---

## D4 — Active indication (百葉窗 shade) and the header/clear UI

**Decision**:
- **Selection**: add `onClick` to the recharts `<Bar>` (fires with the datum); toggle `subDrilldown` (same name → clear).
- **Active indication — "百葉窗"/shade**: when a subcategory is selected, the **non-selected** bars are covered by a lightweight semi-transparent overlay that animates **down** (and retracts on clear), leaving the selected bar showing through. Realized as a CSS `transform`/opacity transition on an overlay (GPU-composited, 60fps on mobile) — explicitly **not** literal louvered slats, which add many animating elements for no real benefit. May be done via per-`<Cell>` `fillOpacity` transition or a positioned overlay layer over the chart with the selected bar excluded; the exact technique is an implementation detail.
- **Header**: when `subDrilldown` is set, the drilldown header shows a breadcrumb `Major › Subcategory` and the net subcategory total (D3); a dedicated **clear control** ("show all" affordance) sits in the header. Both the clear control and re-tapping the active bar clear the selection (spec clarification: *both*).

**Rationale**: recharts `<Bar onClick>` + `<Cell>` are already in the codebase (the pie uses both), so selection reuses known-good patterns. The shade is the cheap realization of the user's 百葉窗 metaphor; the literal-slat version was considered and rejected on mobile-performance grounds. The breadcrumb mirrors the existing back-button header row.

**Alternatives considered**: literal venetian-blind slats — rejected (heavier/jankier on mobile, no functional gain). A separate filter chip row (like `FilterBar`) — rejected as heavier than needed; the bar + header already convey state.

---

## D5 — Testing strategy (no PWA unit harness)

**Decision**: Rely on (1) `tsc` typecheck, (2) the i18n key-parity guard `pnpm i18n:check` + the typed `en.ts` for any new label, and (3) a **Playwright E2E smoke** in `e2e/tests/` that drills into a major category, taps a subcategory bar, asserts the transaction list narrows and the header breadcrumb appears, then clears and asserts restoration. Manual verification follows the `quickstart.md` mockup.

**Rationale**: The PWA has **no** Vitest/component-test setup (confirmed: only `i18n:check` script, no `*.test.tsx`). The constitution's unit-test mandate targets CF Workers handlers and Android logic, neither of which this feature touches. Playwright (feature 028 stack) is the project's front-end behavioral safety net; extending it is the house-consistent choice.

**Alternatives considered**: introducing Vitest + React Testing Library just for this feature — rejected (new test framework for a one-screen change violates Simplicity-First; the e2e suite already exercises the Summary screen).
