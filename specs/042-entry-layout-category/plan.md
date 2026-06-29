# Implementation Plan: Entry Fee/Refund Layout Alignment + Major-Category Selector

**Branch**: `042-entry-layout-category` | **Date**: 2026-06-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/042-entry-layout-category/spec.md`

## Summary

Two presentation-layer changes, both PWA-only, no DB/backend changes:

- **A. Fee/Refund layout** — rework `EntryScreen.tsx` `FeeForm` + `RefundForm` to the synced design (`pwa/design-preview/refined/entry-fee|entry-refund/optimized.html`): unified field order (金額 → 連結原始交易 → 付款管道 → [分類, fee] → 說明), 連結原始交易 promoted to a rich card directly under 金額, direction cues (附加成本 / 綠色 +退回), refund full/partial + 原金額 hint inside the card, and an inline readiness hint above submit. Auto-fill behavior (spec 041) is preserved unchanged — only relocated/repackaged.
- **B. Major-category selector** — rework `CategoryPicker.tsx` so the major row is a frequency-ranked top-N set + a 「更多」 opener (reusing the existing `BottomSheet`), instead of a horizontal-scroll strip; sub-category chips also frequency-ordered. Frequency is derived client-side from recent transactions via a new `useCategoryUsage` hook, computed once per session — no new backend.

## Technical Context

**Language/Version**: TypeScript ~5.x, React 18 (PWA under `pwa/`)
**Primary Dependencies**: Vite, Tailwind CSS v4, `@tanstack/react-query`; existing components `BottomSheet`, `ParentSearch`, `PaymentPills`, `CategoryPicker`, `DescriptionSuggest`; existing hooks `useCategories`, `useTransactions`
**Storage**: N/A — no schema/data change. Reads existing PWA API (`/pwa/transactions`, `/pwa/categories`, `/pwa/parent-search`) only
**Testing**: Playwright e2e (`e2e/`); manual quickstart on `pnpm dev` (pwa port 5300). `tsc -b` + `pnpm i18n:check` as build gates
**Target Platform**: Mobile PWA (Cloudflare Pages); 390px reference width
**Project Type**: web (PWA frontend + CF Workers backend) — this feature is **frontend-only**
**Performance Goals**: 60 fps interaction; category-usage ranking computed once per session (memoized), no per-render cost; one bounded transactions fetch on entry (cached by react-query)
**Constraints**: PWA presentation-only; DB unchanged (single-character major names retained); new visible strings in zh + en
**Scale/Scope**: Single user; ~9 majors, ~133 categories; 2 forms + 1 shared component + 1 new hook

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First** — Reuses existing components (`BottomSheet`, `ParentSearch`); adds one small read-only hook (`useCategoryUsage`) and no new project component, service, or backend. No multi-user/abstractions. Frequency is a client-side count over already-available data. No Complexity Tracking entries required.
- [x] **II. Offline-First on Android** — N/A. No Android changes; PWA-only.
- [x] **III. Serverless Boundary Compliance** — N/A. No CF Workers changes; reuses existing read endpoints. No new slow operations.
- [x] **IV. Automation Over Manual Input** — Aligned/positive: link-as-primary auto-fills downstream fields and frequency-ranking surfaces the most-used categories first, reducing manual touches.
- [x] **V. Security at System Boundaries** — N/A. No secrets, auth, or new data-access paths; no Supabase/Android boundary touched.

*All gates pass. No violations to justify.*

## Project Structure

### Documentation (this feature)

```text
specs/042-entry-layout-category/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (derived ranking + link-card view model)
├── quickstart.md        # Phase 1 output (manual verification)
├── contracts/           # Phase 1 output (UI contracts)
│   ├── category-picker.md
│   └── fee-refund-layout.md
└── checklists/
    └── requirements.md  # (from /speckit-specify)
```

### Source Code (repository root)

```text
pwa/
├── src/
│   ├── screens/
│   │   └── EntryScreen.tsx          # MODIFY: FeeForm + RefundForm layout (Scope A)
│   ├── components/
│   │   ├── CategoryPicker.tsx       # MODIFY: major top-N + 更多 sheet, freq ordering (Scope B)
│   │   ├── ParentSearch.tsx         # MODIFY: linked-state "rich card" (note/payment/category/amount/date + ✕)
│   │   ├── BottomSheet.tsx          # REUSE (no change)
│   │   └── PaymentPills.tsx         # REUSE (no change)
│   ├── hooks/
│   │   ├── useCategoryUsage.ts      # NEW: client-side frequency ranking (majors + subs)
│   │   └── useCategories.ts         # REUSE (majors/subs source)
│   └── i18n/
│       ├── zh.ts                    # MODIFY: new visible strings
│       └── en.ts                    # MODIFY: parity
└── design-preview/refined/          # reference mockups (already synced)

e2e/
└── tests/                           # ADD/UPDATE: order + selector smoke (optional, see quickstart)
```

**Structure Decision**: Frontend-only change inside the existing `pwa/` React app. No new top-level project, no backend or Android changes.

## Complexity Tracking

> No constitution violations — table intentionally empty.
