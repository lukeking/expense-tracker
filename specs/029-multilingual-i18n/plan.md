# Implementation Plan: Multilingual (i18n) Support

**Branch**: `029-multilingual-i18n` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/029-multilingual-i18n/spec.md`

## Summary

Make the PWA's interface fully bilingual (Traditional Chinese + English) by extracting the ~233 hardcoded zh-TW string literals scattered across 24 files in `pwa/src` into a single typed message catalog, and routing every static UI string through a lightweight in-house `t()` accessor that resolves against the user's selected language.

The language-selection plumbing **already exists** and is reused as-is: `SettingsContext` already persists `lang` (`'zh' | 'en'`, default `'zh'`) to `localStorage['lang']`, `SettingsSheet` already renders a working language toggle, and `App.tsx` already demonstrates the reactive bilingual pattern (`NAV_LABELS = { zh, en }` consumed via `useSettings().lang`). This feature generalizes that one-off pattern into a project-wide catalog. No new runtime dependency is introduced — an i18n library would be overkill for two static languages behind a fixed default (Constitution Principle I, Simplicity-First).

Per the spec clarifications: only static UI chrome is translated (DB-sourced content stays in its stored form), date/number/currency formatting is unchanged in both languages, and the first-launch default stays zh-TW with no browser auto-detection.

## Technical Context

**Language/Version**: TypeScript 5.5, React 18.3 (function components + hooks), built with Vite 5.4 (`vite-plugin-pwa`).
**Primary Dependencies**: **None new.** In-house i18n module (catalog + `t()` + `useT()` hook). Existing: react, react-dom, react-router-dom (hash router), @tanstack/react-query, recharts, Tailwind 4.
**Storage**: Browser `localStorage` — existing key `lang` (`'zh' | 'en'`, default `'zh'`). No backend or DB changes.
**Testing**: Existing Playwright E2E suite (feature 028, `e2e/`) continues to run in the default zh experience; add an English-mode smoke assertion. Compile-time key-parity enforced via TypeScript (en catalog typed against the zh base). No new test framework.
**Target Platform**: Mobile-first browser PWA (installed/standalone + browser tabs).
**Project Type**: Web application — this feature touches the **PWA front-end only** (`pwa/`). Backend (`backend/`) and Android are untouched.
**Performance Goals**: Language switch reflects in the same render pass with no reload (already true for context consumers); catalog adds only a few KB of strings, no library weight.
**Constraints**: Language codes stay `'zh'`/`'en'` (zh ≡ Traditional Chinese / zh-TW) to avoid a localStorage migration (surgical). Extracted zh strings MUST match current wording byte-for-byte (FR-008). Missing-key lookups fall back to the zh base text (FR-007).
**Scale/Scope**: ~233 CJK-bearing lines across 24 files → an estimated ~150–200 unique message keys. Heaviest files: `ImportScreen.tsx` (49), `EntryScreen.tsx` (31), `SummaryScreen.tsx` (20), `EditExpenseSheet.tsx` (19).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First (Personal Tool)** — PASS. No new dependency, no multi-user/multi-tenant abstraction. The chosen approach (typed catalog + tiny `t()`) is the *fewest moving parts* option and reuses the existing `lang` context and the inline-map pattern already in `App.tsx`. Declining to add react-i18next/react-intl is the simplicity-aligned decision (see research D1). No new project component → no Complexity Tracking entries required.
- [x] **II. Offline-First on Android** — N/A. No Android changes. (The PWA catalog is bundled at build time, so it is inherently offline-available.)
- [x] **III. Serverless Boundary Compliance** — N/A. No CF Worker code changes; no new handlers, gateway, or slow ops.
- [x] **IV. Automation Over Manual Input** — N/A. Capture, parsing, and receipt-matching flows are unchanged. Translation is presentational only; in-progress input is preserved across a language switch (FR-003).
- [x] **V. Security at System Boundaries** — N/A / PASS. Client-only, presentational change. No secrets touched, no new network boundary, no credentials in source.

*Post-Phase-1 re-check*: still PASS — the design adds only a front-end string module and a hook; no new components, dependencies, or data-access patterns.

## Project Structure

### Documentation (this feature)

```text
specs/029-multilingual-i18n/
├── plan.md              # This file
├── spec.md              # Feature spec (+ Clarifications)
├── research.md          # Phase 0 decisions (D1–D7)
├── data-model.md        # Phase 1 — i18n entities (no DB)
├── quickstart.md        # Phase 1 — translate a string / add a language / verify
├── contracts/
│   └── i18n-api.md       # Phase 1 — public i18n module interface + key contract
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
pwa/src/
├── i18n/                     # NEW — the i18n module
│   ├── index.ts              # t(key, params?), useT() hook, translate(), types (Messages, MessageKey)
│   ├── zh.ts                 # base catalog (source of truth; current wording verbatim)
│   └── en.ts                 # English catalog, typed as Messages → compile error on any missing key
├── context/
│   └── SettingsContext.tsx   # UNCHANGED for state; lang/setLang/persistence/default already present
├── components/
│   └── SettingsSheet.tsx     # existing language toggle reused (labels themselves get keyed)
├── App.tsx                   # migrate inline NAV_LABELS → catalog keys; Suspense fallback → t()
├── screens/                  # EntryScreen, SummaryScreen, BudgetScreen, ImportScreen → strings → t()
└── components/*.tsx          # ~20 components → strings → t()

e2e/
└── tests/                    # ADD an English-mode smoke (set localStorage lang='en', assert EN label)
```

**Structure Decision**: A new `pwa/src/i18n/` directory holds the catalog and accessor — co-located with the rest of the front-end source, mirroring the existing `context/`, `hooks/`, `lib/` layout. The `t()`/`useT()` API is the single seam every component uses; `useT()` derives from `useSettings().lang`, keeping the catalog out of `SettingsContext` (no circular dependency, settings stays state-only). zh is the base catalog; `en` is typed against it so TypeScript fails the build if any key is missing — this is the compile-time guard for SC-002 (full coverage). No backend, DB, or Android files are touched.

## Complexity Tracking

> No Constitution violations. No new components, dependencies, or data-access patterns introduced — table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| (none)    | —          | —                                    |

## Phase Notes

**Phase 0 (research.md)** — resolved: i18n approach (D1: in-house vs library), catalog structure & key naming (D2), interpolation/plurals (D3), accessor placement & reactivity (D4), language-code naming `zh`/`en` vs `zh-TW` (D5), extraction sequencing (D6), coverage/regression testing (D7).

**Phase 1 (this command)** — produced data-model.md (SupportedLanguage, MessageCatalog, LanguagePreference; no DB), contracts/i18n-api.md (the `t`/`useT` interface + key-parity + fallback contract), quickstart.md (translate a string / add a language / run the coverage + e2e checks). Agent context (`CLAUDE.md`) updated to point here.

**Phase 2 (/speckit-tasks)** — will decompose into: scaffold `pwa/src/i18n/` (types, `t`, `useT`, fallback); build the zh base catalog by extracting verbatim strings; author the en catalog (TS parity); migrate files P-ordered (common/nav → EntryScreen → Summary → Budget → Import → remaining components); migrate `App.tsx` NAV_LABELS + Suspense fallback into the catalog; add the residual-CJK coverage check + English-mode e2e smoke; verify zh wording unchanged and en switch is leak-free.
