# Implementation Plan: Summary Subcategory Filter

**Branch**: `030-summary-subcategory-filter` | **Date**: 2026-06-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/030-summary-subcategory-filter/spec.md`

## Summary

Add a second-level (subcategory) filter to the Summary screen's major-category drilldown. Today, drilling into a pie slice shows a horizontal bar chart of the major's subcategories plus the major-filtered transaction list; tapping a bar only pops a value tooltip. This feature makes a bar tap **select** that subcategory and narrow the transaction list below to it, with a breadcrumb header showing the net subcategory total, a 百葉窗 shade over the non-selected bars, and two ways to clear (re-tap the active bar, or a dedicated clear control).

**Technical approach**: Almost entirely a **PWA, client-side** change in `pwa/src/screens/SummaryScreen.tsx`, plus **one backend field**. The subcategory filter is applied **in memory** over the already-loaded major-category transaction list (`useTransactions(...)` for the drilldown) rather than via a new server round-trip — instant, no flicker, drawn from the exact same rows as the unfiltered major list, and able to handle the `其他`/Other bucket which a server `category=Major:其他` filter would silently miss. Subcategory **amounts** (header total, per-day subtotals) are summed from each matching item's stored net amount (`effective_amount`), so they reflect actual subcategory spend and reconcile with the day list. The single backend change is adding `effective_amount` to the `/pwa/transactions` item select (it is already a persisted column, just not currently returned). No new endpoint, query parameter, or DB change.

Per the spec clarifications (2026-06-17): the user's two goals are (1) **which days** had subcategory spending — answered by the day-grouped filtered list — and (2) **how much** in total — answered by the net subcategory total in the header. Clearing is supported **both** by re-tapping the active bar and by a dedicated clear control. The active subcategory is indicated by a lightweight "百葉窗"/shade overlay that animates down over the non-selected bars (CSS transition; no literal slats).

## Technical Context

**Language/Version**: TypeScript 5.5, React 18.3 (function components + hooks), Vite 5.4 (`vite-plugin-pwa`).
**Primary Dependencies**: **None new.** Existing: react, @tanstack/react-query (data hooks in `hooks/useSummary.ts`), recharts (the `BarChart`/`Bar`/`Cell` already used), in-house i18n (`src/i18n/`), Tailwind 4.
**Storage**: No `localStorage`, no DB change. `effective_amount` is an existing persisted column on `transaction_items` — this feature only adds it to one read query's projection. The selection is ephemeral component state.
**Testing**: No PWA unit-test harness exists (PWA has only `pnpm i18n:check` + `tsc`). Coverage = TypeScript typecheck, the i18n key-parity guard (zh = en) for any new label, and the Playwright E2E suite (`e2e/`) extended with a drilldown→subcategory-filter smoke (assert list narrows + day grouping + header net total + clear). Plus manual verification against the mockup in `quickstart.md`. The backend handler change is covered by the existing Vitest worker tests for `/pwa/transactions` (extend to assert `effective_amount` is present).
**Target Platform**: Mobile-first browser PWA.
**Project Type**: Web application — **PWA front-end** (`pwa/`) plus a one-line addition to one CF Worker handler (`backend/src/handlers/pwa.ts`). Android untouched.
**Performance Goals**: Bar tap reflects in the same render pass — the filter + amount sum is in-memory over rows already fetched; no network call, no spinner. The shade overlay is a GPU-composited CSS transition (60fps on mobile).
**Constraints**: Reuse the existing drilldown data flow; do not add a new query or backend param (only the `effective_amount` projection). Subcategory amounts MUST be summed from matching items' `effective_amount` (net of discounts), exact for item-tagged spend; the bar's remainder/fallback apportionment for transaction-level-only tags is NOT re-implemented client-side. Any new UI label MUST exist in both `zh.ts` and `en.ts`.
**Scale/Scope**: One screen + one backend select line. ~1 new component state field, a small membership predicate + per-item net sum (~20 lines), recharts `onClick` + per-`Cell` shade, a breadcrumb header + clear control, day-grouped filtered list, and 1–2 new i18n keys.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First (Personal Tool)** — PASS. Fewest-moving-parts option: one extra `useState` + an in-memory filter/sum, no new component, no new dependency, no new query/endpoint. Computing amounts client-side from `effective_amount` is simpler than a new server aggregation, and not re-implementing the backend's remainder apportionment avoids duplicated logic (research D1/D3). No new component → no Complexity Tracking entry.
- [x] **II. Offline-First on Android** — N/A. No Android changes.
- [x] **III. Serverless Boundary Compliance** — PASS. The only backend change adds an existing column to one `select` projection in `GET /pwa/transactions`; no new handler, no slow op, no boundary change. Memory/CPU impact negligible (one extra numeric field per item row).
- [x] **IV. Automation Over Manual Input** — N/A. Capture/parse/match flows unchanged; this is a presentational read-side filter.
- [x] **V. Security at System Boundaries** — N/A / PASS. No secrets, no new network boundary; `effective_amount` is non-sensitive financial data already exposed via the summary endpoint.

*Post-Phase-1 re-check*: still PASS — the design adds component-local state, an in-memory predicate + net-sum, a couple of presentational labels, and one extra projected column; no new components, dependencies, endpoints, or data-access patterns.

## Project Structure

### Documentation (this feature)

```text
specs/030-summary-subcategory-filter/
├── plan.md              # This file
├── spec.md              # Feature spec (+ Clarifications)
├── research.md          # Phase 0 decisions (D1–D5)
├── data-model.md        # Phase 1 — view-state + membership model (no DB)
├── quickstart.md        # Phase 1 — UI mockup + manual verification + e2e
├── contracts/
│   └── ui-contract.md   # Phase 1 — drilldown interaction contract (states, transitions, predicate)
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/src/handlers/pwa.ts   # ONE LINE: add effective_amount to the GET /pwa/transactions
                              #   transaction_items(...) select projection

pwa/src/
├── screens/
│   └── SummaryScreen.tsx     # PRIMARY change: subDrilldown state; Bar onClick (toggle);
│                             #   per-Cell shade overlay (百葉窗); breadcrumb header + clear control;
│                             #   in-memory subcategory filter (membership) + net-amount sum
│                             #   (matching items' effective_amount) for header/day subtotals;
│                             #   day-grouped list; reset subDrilldown wherever drilldown resets
├── hooks/
│   └── useSummary.ts         # add effective_amount to the TxItem type (payload now carries it)
├── i18n/
│   ├── zh.ts                 # ADD label(s): e.g. summary.showAll (clear control / aria-label)
│   └── en.ts                 # ADD matching key(s) — parity enforced by tsc
└── (optionally) lib/         # only if the membership/net-sum helpers are extracted as pure fns

e2e/
└── tests/                    # ADD a smoke: drill into a major, tap a subcategory bar; assert list
                              #   narrows + day-grouped + header net total; clear restores the list
```

**Structure Decision**: The feature lives in `SummaryScreen.tsx`, which already owns `drilldown`, the `subData` bar chart, and the `txData` list. A new sibling state field `subDrilldown: string | null` gates the in-memory filter, the net-amount sums, and the header/active-bar presentation, and is reset alongside `drilldown` in the existing handlers (`handleTimeBaseChange`, `handleNavigate`, `handlePickerSelect`, the back button, and on selecting a different major). The `TxItem` type in `hooks/useSummary.ts` gains `effective_amount` to match the enriched payload. The membership predicate + net-sum may be inlined or extracted to `lib/` as pure functions; either is acceptable under Simplicity-First. No new data hook or query is introduced.

## Complexity Tracking

> No Constitution violations. No new components, dependencies, or data-access patterns introduced — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    | —          | —                                    |

## Phase Notes

**Phase 0 (research.md)** — resolved: client-side filtering + client-side net-amount sum, with `effective_amount` added to the transactions payload (D1), the subcategory membership predicate incl. the `其他` bucket (D2), net-amount reconciliation via `effective_amount` and the transaction-level-only-tag edge that is deliberately not reproduced client-side (D3), active-bar indication via the 百葉窗 shade overlay + breadcrumb/clear UI (D4), and testing strategy given no PWA unit harness (D5).

**Phase 1 (this command)** — produced data-model.md (drilldown view-state + membership rule + net-amount contribution; the added `effective_amount` field), contracts/ui-contract.md (interaction states, transitions, the filter + amount contract), quickstart.md (ASCII mockup of the selected/cleared header, the shade, day-grouped list, manual verification, the e2e smoke). Agent context (`CLAUDE.md`) updated to point here.

**Phase 2 (/speckit-tasks)** — will decompose into: backend — add `effective_amount` to the `/pwa/transactions` select (+ extend its worker test); PWA — add `effective_amount` to `TxItem`; add `subDrilldown` state + resets; wire `Bar onClick` toggle and the per-`Cell` shade overlay; render the breadcrumb header with the net subcategory total + clear control (re-tap and explicit); apply the in-memory membership filter + net-amount sums to the day-grouped drilldown list (incl. `其他`); add the i18n label(s) to zh+en; add the Playwright smoke; verify against the mockup.

## Known limitation (updated 2026-06-18 — see research D3 correction)

`subAmount` is a **faithful client-side port of the backend `aggregateBySubcategory`** per-transaction logic (matched items' `effective_amount` + the remainder/fallback that follows the tx's own category tag). It therefore reconciles with the bar for **all** transaction shapes — item-tagged, inherited (tx-level tag, untagged items), itemless, discounted, and refunds. This replaced an earlier approach that summed only items whose **own** tag matched; under feature 027 (B2) items normally **inherit** the tx category, so that approach returned NT$0 for the common case (caught in manual verification, 2026-06-18). The only residual is presentational: the per-item line breakdown shown under the filter (own-or-inherited per item) may not sum exactly to the row total in rare mixed-tag transactions; the row total (`subAmount`) is authoritative and matches the bar. FR-005/SC-002 hold for all of these.
