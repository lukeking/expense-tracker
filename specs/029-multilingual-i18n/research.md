# Phase 0 Research: Multilingual (i18n) Support

**Feature**: 029-multilingual-i18n | **Date**: 2026-06-15

All Technical Context unknowns are design choices (no external/unknown technology). Each decision below is recorded as Decision / Rationale / Alternatives.

## D1 — i18n approach: in-house catalog vs. library

**Decision**: Build a **lightweight in-house** i18n module — a typed message catalog plus a tiny `t(key, params?)` accessor exposed through a `useT()` hook. No i18n library is added.

**Rationale**:
- Constitution Principle I (Simplicity-First, YAGNI, "fewest moving parts"): the app needs exactly **2 static languages** behind a **fixed default** with **no locale-specific formatting** (spec Q2/Q3). That removes the main reasons to adopt a library (runtime locale negotiation, ICU number/date formatting, pluralization engines, lazy namespace loading).
- The pattern already exists in the codebase: `App.tsx` ships `NAV_LABELS = { zh: {...}, en: {...} }` consumed reactively via `useSettings().lang`. This feature generalizes that proven pattern rather than introducing a parallel mechanism.
- Reactivity and persistence are already solved by `SettingsContext` (`lang` state + `localStorage['lang']`), so a library would duplicate plumbing we already have.
- Zero added bundle weight and zero new config surface.

**Alternatives considered**:
- **react-i18next / i18next** — the ecosystem default. Rejected: provider + init config + namespaces + plugin model is disproportionate for 2 static languages; adds bundle size and a Suspense-based loading story we don't need (catalog is bundled).
- **react-intl (FormatJS)** — strong ICU message/format support. Rejected: its core value is locale-aware number/date/plural formatting, which the spec explicitly scopes **out** (Q2); the heavier `<FormattedMessage>` API buys nothing here.
- **LinguiJS** — ergonomic macros. Rejected: introduces a build-time macro/compile step (extra tooling) for no functional gain at this scale.

## D2 — Catalog structure & key naming

**Decision**: One module per language under `pwa/src/i18n/`: `zh.ts` (base/source of truth) and `en.ts`. Each exports a **flat object keyed by dotted namespace strings** (e.g. `'entry.submit'`, `'import.uploadCsv'`, `'common.loading'`). A `Messages` type is derived from the zh object; `en` is declared `const en: Messages = { ... }` so TypeScript flags any missing or misspelled key at compile time.

**Rationale**:
- A flat dotted-key object keeps the `t()` implementation trivial (single map lookup, no path walking) while dotted prefixes give human-readable grouping by screen/component.
- Deriving the key type from zh and typing en against it makes **full coverage a compile-time guarantee** (supports SC-002) — a missing English string is a build break, not a runtime surprise.
- Namespacing by area (`entry.*`, `summary.*`, `budget.*`, `import.*`, `common.*`, `settings.*`) maps cleanly onto the file-by-file extraction order.

**Alternatives considered**:
- **Nested object catalog** (`messages.entry.submit`) — slightly prettier authoring but needs a path-walking `t()` and weaker key typing; rejected for added accessor complexity.
- **JSON files** — would invite a loader/Suspense story; rejected, plain TS modules are bundled and fully typed.

## D3 — Interpolation & pluralization

**Decision**: Support simple named-placeholder interpolation only: `t('summary.selectedCount', { n })` where the message contains `{n}`. The helper does plain `{name}` → value replacement. **No pluralization engine.** Where English would need a plural, author the copy to read acceptably for any count (e.g. neutral phrasing or `N item(s)`); Chinese has no plural inflection.

**Rationale**: A handful of strings embed counts/amounts/names. Plain placeholder substitution covers them with a few lines of code. ICU plural rules are unnecessary for 2 languages where one has no plurals and the other has only a few cases that copy can absorb — consistent with D1 / Simplicity-First.

**Alternatives considered**: ICU `plural`/`select` (rejected: pulls back toward a library, over-engineered for the case count).

## D4 — Accessor placement & reactivity

**Decision**: The catalog and accessor live in `pwa/src/i18n/index.ts`, **not** inside `SettingsContext`. `useT()` reads `const { lang } = useSettings()` and returns a memoized `(key, params?) => translate(lang, key, params)`. A non-hook `translate(lang, key, params)` is exported for the rare non-component call site.

**Rationale**:
- Keeps `SettingsContext` state-only (no dependency on the catalog → no import cycle).
- Because `lang` is React context state, any component calling `useT()` re-renders when `lang` changes, so a language switch updates the whole tree in the same render pass with **no reload and no loss of in-progress input** (FR-003) — this is already demonstrated by the existing `NavBar`.

**Alternatives considered**: putting `t` on `useSettings()` directly (rejected: couples settings to the catalog); a separate React context for i18n (rejected: redundant — `lang` already lives in a context).

## D5 — Language code naming: keep `zh`/`en` vs adopt `zh-TW`

**Decision**: Keep the **existing `'zh'` / `'en'`** codes. Document that `zh` ≡ Traditional Chinese (zh-TW) in the catalog and data model.

**Rationale**: `localStorage['lang']` already stores `'zh'`/`'en'` for current users; switching to `'zh-TW'` would force a migration/back-compat shim for zero user-visible benefit. Surgical-changes principle: don't rename a working identifier. The spec's "zh-TW" is a display/locale label, satisfied by treating `zh` as Traditional Chinese.

**Alternatives considered**: rename to BCP-47 `zh-TW` (rejected: needless migration; revisit only if a second Chinese variant is ever added).

## D6 — Extraction sequencing

**Decision**: Extract strings **file-by-file, priority-ordered** to keep each step independently verifiable:
1. Shared + navigation: `common.*` (loading, save/cancel/confirm), `App.tsx` NAV_LABELS, `SettingsSheet` labels.
2. `EntryScreen` (the P1 core add-expense flow).
3. `SummaryScreen` + `SummaryNav` + `FilterBar` + `PeriodPicker`.
4. `BudgetScreen`.
5. `ImportScreen` (heaviest, 49 lines) + import components (`AmbiguousInvoiceCard`, `ManualLinkSheet`).
6. Remaining components (`EditExpenseSheet`, `EditHistorySection`, `ItemRow`, `ItemCategorySheet`, `CategoryPicker`, `ParentSearch`, `PaymentPills`, `AdjustmentRow`, `TagInput`, `ApiKeyPrompt`, `lib/itemCategory.ts`, `hooks/useSummary.ts`).

Each file: move the literal into `zh.ts` (verbatim, FR-008), add the en string, replace the in-code literal with `t('key')`. After each priority group, re-run the zh-default e2e suite and toggle to en to spot leaks.

**Rationale**: Priority order matches the spec's user-story priorities (P1 add-expense first), produces a working bilingual slice early, and bounds review to one screen at a time. Verbatim zh extraction guarantees the default experience is visually unchanged.

**Note (DB-sourced strings to leave alone, per Q1)**: literals that are *category/label data* rather than chrome stay as data. In particular review `lib/itemCategory.ts` and `hooks/useSummary.ts` CJK lines case-by-case — translate UI chrome, leave any category/label data values untouched.

## D7 — Coverage & regression testing

**Decision**: Three lightweight guards, no new framework:
1. **Compile-time parity** — `en` typed as `Messages` (from zh) → a missing/renamed key fails `tsc`/build. Primary guard for SC-002.
2. **Residual-CJK check** — a small script/grep that flags CJK string literals remaining in `pwa/src` **outside** `pwa/src/i18n/`, so newly-leaked hardcoded chrome is caught. Allowlist the catalog and any intentional DB-data literals identified in D6.
3. **English-mode e2e smoke** — extend the existing Playwright suite (feature 028): set `localStorage['lang'] = 'en'` and assert a known label renders in English (e.g. the nav "Entry"), complementing the default zh runs.

**Rationale**: The type system does the heavy lifting on coverage for free; the CJK scan catches future regressions cheaply; the e2e smoke proves the end-to-end switch in a real browser. All reuse existing tooling (TypeScript + the 028 Playwright harness) per Simplicity-First.

**Alternatives considered**: a full per-screen English snapshot suite (deferred: higher maintenance than the type guard + single smoke warrant for a personal app); an i18n-lint plugin (rejected: new tooling for what a grep covers).

---

## Open Risks

- **None blocking.** The only judgment calls are per-string: deciding chrome-vs-data on the few literals in `lib/itemCategory.ts` / `hooks/useSummary.ts` (handled in D6), and authoring natural English copy for ~150–200 keys (mechanical, reviewed during migration).
