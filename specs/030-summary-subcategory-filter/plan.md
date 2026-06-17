# Implementation Plan: Summary Subcategory Filter

**Branch**: `030-summary-subcategory-filter` | **Date**: 2026-06-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/030-summary-subcategory-filter/spec.md`

## Summary

Add a second-level (subcategory) filter to the Summary screen's major-category drilldown. Today, drilling into a pie slice shows a horizontal bar chart of the major's subcategories plus the major-filtered transaction list; tapping a bar only pops a value tooltip. This feature makes a bar tap **select** that subcategory and narrow the transaction list below to it, with a breadcrumb header showing the subcategory total, an active-bar highlight, and two ways to clear (re-tap the active bar, or a dedicated clear control).

**Technical approach**: This is a **PWA-only, client-side** change confined almost entirely to `pwa/src/screens/SummaryScreen.tsx`. The subcategory filter is applied **in memory** over the already-loaded major-category transaction list (`useTransactions(...)` for the drilldown) rather than via a new server round-trip. That reuses data already on the client (instant, no loading flicker), keeps the filtered list drawn from the exact same rows as the unfiltered major list, and lets us handle the `其他`/Other bucket (untagged-under-major spend) which a server `category=Major:其他` filter would silently miss. No backend, DB, or API change is required.

Per the spec clarifications (2026-06-17): clearing is supported **both** by re-tapping the active bar and by a dedicated clear control; while a subcategory is selected the drilldown header shows a breadcrumb (Major › Subcategory) with the **selected subcategory's total** as the headline figure, reverting to the major total on clear.

## Technical Context

**Language/Version**: TypeScript 5.5, React 18.3 (function components + hooks), Vite 5.4 (`vite-plugin-pwa`).
**Primary Dependencies**: **None new.** Existing: react, @tanstack/react-query (data hooks in `hooks/useSummary.ts`), recharts (the `BarChart`/`Bar`/`Cell` already used), in-house i18n (`src/i18n/`), Tailwind 4.
**Storage**: None. No `localStorage`, no backend, no DB. The selection is ephemeral component state.
**Testing**: No PWA unit-test harness exists (PWA has only `pnpm i18n:check` + `tsc`). Coverage = TypeScript typecheck, the i18n key-parity guard (zh = en) for any new label, and the Playwright E2E suite (`e2e/`) extended with a drilldown→subcategory-filter smoke. Plus manual verification against the mockup in `quickstart.md`.
**Target Platform**: Mobile-first browser PWA.
**Project Type**: Web application — **PWA front-end only** (`pwa/`). Backend (`backend/`) and Android untouched.
**Performance Goals**: Bar tap reflects in the same render pass — the filter is an in-memory `Array.filter` over rows already fetched; no network call, no spinner.
**Constraints**: Reuse the existing drilldown data flow; do not add a new query or backend param. The header total for the selected subcategory MUST equal the value on the tapped bar (source it from the same `subData.subcategories[]` the bar is drawn from, not from a re-summed list). Any new UI label MUST exist in both `zh.ts` and `en.ts`.
**Scale/Scope**: One screen. ~1 new component state field, ~1 small membership predicate (~12 lines), recharts `onClick` + per-`Cell` fill, a breadcrumb header + clear control, and 1–2 new i18n keys.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First (Personal Tool)** — PASS. Fewest-moving-parts option: one extra `useState` + an in-memory filter, no new component, no new dependency, no new query/endpoint. Client-side filtering of already-loaded rows is simpler than threading a new server param and avoids the `其他` correctness gap (see research D1). No new component → no Complexity Tracking entry.
- [x] **II. Offline-First on Android** — N/A. No Android changes.
- [x] **III. Serverless Boundary Compliance** — N/A. No CF Worker code changes; no new handler or slow op.
- [x] **IV. Automation Over Manual Input** — N/A. Capture/parse/match flows unchanged; this is a presentational read-side filter.
- [x] **V. Security at System Boundaries** — N/A / PASS. Client-only; no secrets, no new network boundary.

*Post-Phase-1 re-check*: still PASS — the design adds only component-local state, an in-memory predicate, and a couple of presentational labels; no new components, dependencies, or data-access patterns.

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
pwa/src/
├── screens/
│   └── SummaryScreen.tsx     # PRIMARY change: subDrilldown state; Bar onClick (toggle);
│                             #   per-Cell active fill; breadcrumb header + clear control;
│                             #   in-memory subcategory filter of the drilldown tx list;
│                             #   reset subDrilldown wherever drilldown resets
├── i18n/
│   ├── zh.ts                 # ADD label(s): e.g. summary.showAll (clear control / aria-label)
│   └── en.ts                 # ADD matching key(s) — parity enforced by tsc
└── (optionally) lib/         # only if the membership predicate is extracted as a tiny pure helper

e2e/
└── tests/                    # ADD a smoke: drill into a major category, tap a subcategory bar,
                              #   assert the tx list narrows + header breadcrumb; clear restores it
```

**Structure Decision**: The feature lives in `SummaryScreen.tsx`, which already owns `drilldown`, the `subData` bar chart, and the `txData` list. A new sibling state field `subDrilldown: string | null` gates the in-memory filter and the header/active-bar presentation, and is reset alongside `drilldown` in the existing handlers (`handleTimeBaseChange`, `handleNavigate`, `handlePickerSelect`, the back button, and on selecting a different major). The membership predicate may be inlined or extracted to `lib/` as a pure function for clarity; either is acceptable under Simplicity-First. No new data hook is introduced — `hooks/useSummary.ts` is unchanged.

## Complexity Tracking

> No Constitution violations. No new components, dependencies, or data-access patterns introduced — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    | —          | —                                    |

## Phase Notes

**Phase 0 (research.md)** — resolved: client- vs server-side filtering (D1, → client/in-memory), the subcategory membership predicate incl. the `其他` bucket (D2), bar-total↔list-total reconciliation and the cross-subcategory-transaction approximation that matches existing major-level behavior (D3), active-bar indication via recharts per-`Cell` fill + the breadcrumb/clear UI (D4), and testing strategy given no PWA unit harness (D5).

**Phase 1 (this command)** — produced data-model.md (the drilldown view-state machine + the subcategory membership rule; no DB), contracts/ui-contract.md (interaction states, transitions, the filter predicate as the testable contract), quickstart.md (ASCII mockup of the selected/cleared header + active bar, manual verification steps, the e2e smoke). Agent context (`CLAUDE.md`) updated to point here.

**Phase 2 (/speckit-tasks)** — will decompose into: add `subDrilldown` state + resets; wire `Bar onClick` toggle and per-`Cell` active fill; render the breadcrumb header with the subcategory total + clear control (re-tap and explicit); apply the in-memory membership filter to the drilldown tx list (incl. `其他`); add the i18n label(s) to zh+en; add the Playwright smoke; verify against the mockup.

## Known limitation (carried from research D3)

A transaction whose items span **multiple subcategories of the same major** is shown under each matching subcategory at its **full** amount, so for such (uncommon) transactions the sum of listed rows will not penny-match the per-item bar total. This is the **same approximation the existing major-level drilldown already makes** (the major tx list likewise lists whole transactions against a per-item pie slice). Making the list reconcile exactly would require per-item rows — a larger UI change and out of scope. FR-005/SC-002 hold exactly for single-subcategory transactions (the overwhelming majority) and for the `其他` bucket; this caveat is surfaced for sign-off.
