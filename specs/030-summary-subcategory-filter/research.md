# Phase 0 Research: Summary Subcategory Filter

All decisions below are grounded in the current code: `pwa/src/screens/SummaryScreen.tsx`, `pwa/src/hooks/useSummary.ts`, and `backend/src/services/summary.ts` (`aggregateBySubcategory`) / `backend/src/handlers/pwa.ts` (`GET /pwa/transactions`).

---

## D1 — Apply the subcategory filter client-side (in memory), not via a new server fetch

**Decision**: When a subcategory is selected, filter the **already-loaded** major-category transaction list (`useTransactions(timeBase, offset, drilldown, tag, paymentMethod)`) in memory. Do **not** add a new server query or backend parameter.

**Rationale**:
- The drilldown already fetches the full major-category list; the subcategory is a strict subset of rows already on the client. An `Array.filter` is instant — no second round-trip, no loading spinner, no flicker (satisfies the "one tap" success criteria and Performance goal).
- The server `GET /pwa/transactions?category=X` predicate is `tags.some(t => t === X || t.startsWith(X + ':'))`. Passing `Major:Sub` works for normal subcategories **but misses the `其他` bucket**: the bar's `其他` total (from `aggregateBySubcategory`) includes items tagged only with the bare major (no specific subcategory), which never match `t === 'Major:其他'`. Client-side filtering lets us reproduce the bucket correctly (D2).
- Fewer moving parts than threading a new param through the hook + query key + handler (Constitution I).

**Alternatives considered**:
- *Server refetch with `category=Major:Sub`*: rejected — breaks the `其他` bucket, adds a fetch + loading state per tap, and still needs special-casing for `其他`.
- *Re-summing a client list to reproduce `aggregateBySubcategory` exactly*: rejected — the backend aggregation is per-item with a remainder/fallback path; duplicating it on the client is fragile and unnecessary for a row-membership filter (D3).

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

## D3 — Bar-total ↔ list-total reconciliation (and the documented approximation)

**Decision**: Source the **header total** for a selected subcategory directly from `subData.subcategories.find(s => s.subcategory === sub).total` — the same array the bars are drawn from — so the headline figure **always equals the tapped bar exactly**. The transaction list is the membership-filtered set of whole transactions (D2). Accept that for a transaction whose items span multiple subcategories of the same major, the row appears under each at its full amount, so the **sum of listed rows** may not penny-match the per-item bar total.

**Rationale**:
- The bar totals come from `aggregateBySubcategory`, which apportions **per item** (`item.effective_amount`) with a remainder fallback. The transaction list shows **whole** transactions. These two granularities only coincide when a transaction's items all fall in one subcategory — which is the overwhelming majority.
- This is **not a regression**: today's major-level drilldown already lists whole transactions against a per-item pie slice, so the same approximation already exists one level up. We are matching existing app behavior, not introducing a new inconsistency.
- Sourcing the header number from the bar array guarantees the *headline* the user reads is always exact and self-consistent with the chart, even when the row sum drifts for mixed transactions.

**Alternatives considered**:
- *Per-item rows in the filtered list (penny-exact)*: rejected — a substantial change to the transaction list UI, inconsistent with every other list in the app, and out of scope. Flagged in plan.md "Known limitation" for sign-off.

**Spec impact**: FR-005 / SC-002 hold exactly for single-subcategory transactions and the `其他` bucket; the cross-subcategory case is the documented approximation above.

---

## D4 — Active-bar indication and the header/clear UI (recharts)

**Decision**:
- **Selection**: add `onClick` to the recharts `<Bar>` (fires with the datum); toggle `subDrilldown` (same name → clear).
- **Active highlight**: render `<Cell>` children inside `<Bar>` (already the pattern used for the pie), colouring the selected subcategory's cell with the accent and dimming/normalising the rest — no extra DOM, recharts-native.
- **Header**: when `subDrilldown` is set, the drilldown header shows a breadcrumb `Major › Subcategory` and the subcategory total (D3); a dedicated **clear control** (e.g. an `×` / "show all" affordance) sits in the header. Both the clear control and re-tapping the active bar clear the selection (spec clarification: *both*).

**Rationale**: recharts `<Bar onClick>` + `<Cell>` are already in the codebase (the pie uses `onClick` + `<Cell>`), so this reuses known-good patterns with no new library surface. The breadcrumb mirrors the existing back-button header row.

**Alternatives considered**: a separate filter chip row (like `FilterBar`) — rejected as heavier than needed; the bar + header already convey state.

---

## D5 — Testing strategy (no PWA unit harness)

**Decision**: Rely on (1) `tsc` typecheck, (2) the i18n key-parity guard `pnpm i18n:check` + the typed `en.ts` for any new label, and (3) a **Playwright E2E smoke** in `e2e/tests/` that drills into a major category, taps a subcategory bar, asserts the transaction list narrows and the header breadcrumb appears, then clears and asserts restoration. Manual verification follows the `quickstart.md` mockup.

**Rationale**: The PWA has **no** Vitest/component-test setup (confirmed: only `i18n:check` script, no `*.test.tsx`). The constitution's unit-test mandate targets CF Workers handlers and Android logic, neither of which this feature touches. Playwright (feature 028 stack) is the project's front-end behavioral safety net; extending it is the house-consistent choice.

**Alternatives considered**: introducing Vitest + React Testing Library just for this feature — rejected (new test framework for a one-screen change violates Simplicity-First; the e2e suite already exercises the Summary screen).
