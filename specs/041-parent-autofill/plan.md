# Implementation Plan: 連結原始交易 auto-fill (parent-transaction auto-fill for fee/refund)

**Branch**: `041-parent-autofill` | **Date**: 2026-06-28 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/041-parent-autofill/spec.md`

## Summary

When a user links an original transaction ("連結原始交易") while composing a 手續費 (fee) or 退款 (refund) on the Entry screen, pre-fill what is already known on the original so it isn't re-keyed: the **payment method** (both tabs), the **category** (fee tab only, and only when the original resolves to exactly one category), and the **description** (fill-when-empty — existing on fee, extended to refund). The **amount is never auto-filled**, but the refund tab gains a **「全額退款」** one-tap button that sets the amount to the linked original's full amount. Auto-fill is **non-destructive** (never overrides a field the user has touched) and **create-time only** (after submit, only the parent id relationship persists).

**Technical approach**: A small **backend read extension** plus **PWA form wiring** — no DB change, no new endpoint, no new dependency.
- **Backend**: `GET /pwa/parent-search` (`findParentCandidates` in `backend/src/db/queries.ts`) currently returns `id, amount, note, tags, transaction_at, item_names`. Add two derived fields to each result: `payment_method` (a transaction-level column, just add to the `select`) and `category` (the single distinct `主:子` category tag across `tags` + item tags, or `null` when zero/ambiguous — reusing the existing "find the colon tag" pattern from `enrichRefundTags`). The `amount` needed for 全額退款 is already returned.
- **PWA**: extend `ParentSearchResult` with `payment_method` and `category`. In `FeeForm` and `RefundForm`, on parent select, fill **untouched** fields only — payment method (both), category via the existing `parseCategorySelection` helper (fee, only when `category != null`), description (fill-when-empty; extend the refund form to match the fee form's existing behavior). Track "touched" per auto-fillable field so a manual edit is never overwritten on re-link. Add a 「全額退款」 button to `RefundForm`, shown only when a parent is linked, that sets the amount to `parent.amount` (still editable). Add one i18n key (`entry.fullRefund`) to `zh.ts` + `en.ts`.

Per spec clarifications (2026-06-28): category fills only on an **exactly-one-category** original; amount is **never** auto-filled (refund gets 全額退款 instead); auto-fill is **non-destructive + create-time only**.

## Technical Context

**Language/Version**: TypeScript 5.5; PWA = React 18.3 (function components + hooks), Vite 5.4 (`vite-plugin-pwa`); backend = Hono on Cloudflare Workers.
**Primary Dependencies**: **None new.** Existing: react, @tanstack/react-query (`useMutation` in the forms), in-house i18n (`src/i18n/`), Tailwind 4; backend Supabase JS client via the CF Worker.
**Storage**: **No DB change.** `payment_method` is an existing transaction column added to one `select`; `category` is derived in code from existing tags. The selected parent and "touched" flags are ephemeral component state.
**Testing**: Backend = Vitest + `@cloudflare/vitest-pool-workers` (Miniflare) — extend the `/pwa/parent-search` handler test to assert `payment_method` + resolved `category` (single vs. ambiguous → `null`); unit-test the pure category-resolution helper. PWA = TypeScript typecheck (`tsc -b`) + the i18n key-parity guard (zh = en) for the new `entry.fullRefund` label. Optional: a Playwright E2E smoke (link a parent → assert payment pill + category pre-fill; tap 全額退款 → amount = parent total). Plus manual verification against `quickstart.md`.
**Target Platform**: Mobile-first browser PWA + the CF Worker API. Android untouched.
**Project Type**: Web application — PWA front-end (`pwa/`) plus a small read-side extension to one CF Worker endpoint (`backend/src/handlers/pwa.ts` + `backend/src/db/queries.ts`).
**Performance Goals**: Auto-fill runs in the same render pass on parent select (pure, in-memory; no extra network call). `parent-search` returns two extra small fields per candidate (≤5 candidates) — negligible payload/CPU.
**Constraints**: No DB schema change, no new endpoint or query parameter (only the `payment_method` projection + an in-code category derivation). Reuse existing helpers (`parseCategorySelection`, the colon-tag find from `enrichRefundTags`); do not re-implement category logic. Auto-fill MUST be non-destructive (never overwrite a touched field) and create-time only. Any new UI label MUST exist in both `zh.ts` and `en.ts`.
**Scale/Scope**: 2 Entry-screen forms (`FeeForm`, `RefundForm`), 1 shared component type (`ParentSearchResult`), 1 endpoint projection + 1 small pure helper (category resolution), the 全額退款 button, 1 new i18n key.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First (Personal Tool)** — PASS. Fewest-moving-parts option: extend an existing endpoint's projection + one pure derivation; reuse `parseCategorySelection` and the existing colon-tag find instead of new abstractions. "Touched" tracking is a couple of `useState` booleans per form. No new component, dependency, endpoint, or query param → no Complexity Tracking entry.
- [x] **II. Offline-First on Android** — N/A. No Android changes.
- [x] **III. Serverless Boundary Compliance** — PASS. The backend change adds one existing column to a `select` and a synchronous in-memory category derivation over ≤5 already-fetched candidate rows; no new handler, no slow op, no boundary change. Memory/CPU impact negligible.
- [x] **IV. Automation Over Manual Input** — PASS / aligned. Directly serves the principle: linking an original auto-populates known fields, removing manual re-entry. No capture/parse/match flow is changed; manual entry remains single-screen.
- [x] **V. Security at System Boundaries** — N/A / PASS. No secrets, no new network boundary; `payment_method` and category are non-sensitive financial fields already exposed through other PWA endpoints, returned only through the existing authenticated CF Worker.

*Post-Phase-1 re-check*: still PASS — the design adds two projected/derived fields to one read endpoint, component-local "touched" state, a one-tap amount button, and one i18n label; no new components, dependencies, endpoints, or data-access patterns.

## Project Structure

### Documentation (this feature)

```text
specs/041-parent-autofill/
├── plan.md              # This file
├── spec.md              # Feature spec (+ resolved clarifications)
├── research.md          # Phase 0 decisions (D1–D5)
├── data-model.md        # Phase 1 — parent-search result + form view-state (no DB)
├── quickstart.md        # Phase 1 — UI mockup + manual verification + e2e smoke
├── contracts/
│   ├── parent-search.md # Phase 1 — extended GET /pwa/parent-search response contract
│   └── autofill-ui.md   # Phase 1 — form auto-fill behavior contract (states, touched rules)
├── checklists/
│   └── requirements.md  # spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/src/
├── db/queries.ts                # findParentCandidates: add payment_method to the select;
│                                #   return a resolved single-category (主:子 | null) per candidate.
│                                #   New pure helper resolveSingleCategory(tags, itemTags) (colon-tag
│                                #   distinct-set → one or null) — unit-testable, mirrors enrichRefundTags.
├── handlers/pwa.ts              # GET /pwa/parent-search: include payment_method + category in the
│                                #   mapped response objects.
└── (test)                       # extend the parent-search worker test; add resolveSingleCategory unit test

pwa/src/
├── components/ParentSearch.tsx  # ParentSearchResult type: add payment_method + category fields
├── screens/EntryScreen.tsx      # PRIMARY: FeeForm + RefundForm auto-fill on parent select
│                                #   (payment/category/description, untouched-only); "touched" flags;
│                                #   RefundForm 全額退款 button (visible when parent linked) → amount = parent.amount
├── i18n/
│   ├── zh.ts                    # ADD entry.fullRefund: '全額退款'
│   └── en.ts                    # ADD entry.fullRefund: 'Full refund' (parity enforced by tsc/i18n:check)
└── (maybe) lib/                 # only if parseCategorySelection is extracted to share with the Edit sheets

e2e/
└── tests/                       # OPTIONAL smoke: link a parent → payment/category pre-filled; 全額退款 → amount
```

**Structure Decision**: The work splits cleanly across the existing parent-search read path and the two Entry forms. The backend change lives in `findParentCandidates` (data) + the `parent-search` handler mapping (shape), with category resolution as a new pure helper next to `enrichRefundTags` so it is unit-testable in isolation. The frontend change lives entirely in `EntryScreen.tsx`'s `FeeForm`/`RefundForm` plus the `ParentSearchResult` type in `ParentSearch.tsx`; `parseCategorySelection` is reused (and, if shared cleanly, lifted out of the Edit sheets into `lib/`). No new data hook, query, endpoint, or DB migration.

## Complexity Tracking

> No Constitution violations. No new components, dependencies, endpoints, or data-access patterns introduced — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    | —          | —                                    |

## Phase Notes

**Phase 0 (research.md)** — resolves: where category lives and how to derive a single one (D1: tx-level SSOT colon-tag, distinct-set → one-or-null); surfacing payment_method + category through parent-search without a DB/endpoint change (D2); the non-destructive "touched" model for re-link safety (D3); the 全額退款 one-tap design (D4); the testing strategy given the backend Vitest harness + no PWA unit harness (D5).

**Phase 1 (this command)** — produces data-model.md (extended `ParentSearchResult` + the parent's resolved category rule + per-form view-state and touched flags), contracts/parent-search.md (the extended endpoint response fields + category-resolution semantics), contracts/autofill-ui.md (parent-select fill rules per field/tab, touched/clear/re-link transitions, 全額退款), and quickstart.md (ASCII mockups of fee + refund auto-fill, manual verification steps, the optional e2e smoke). Agent context (`CLAUDE.md`) updated to point here.

**Phase 2 (/speckit-tasks)** — will decompose into: backend — add `payment_method` to the `findParentCandidates` select; add the `resolveSingleCategory` pure helper + unit test; include both in the `parent-search` response; extend the worker test. PWA — extend `ParentSearchResult`; add `entry.fullRefund` to zh+en; in `FeeForm`/`RefundForm` add touched flags + non-destructive auto-fill (payment/category/description) on parent select; add the refund 全額退款 button; verify typecheck + i18n parity; optional Playwright smoke; manual verification against the mockup.
