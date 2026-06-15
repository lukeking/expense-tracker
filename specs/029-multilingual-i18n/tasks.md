---

description: "Task list for 029-multilingual-i18n"
---

# Tasks: Multilingual (i18n) Support

**Input**: Design documents from `specs/029-multilingual-i18n/`
**Prerequisites**: plan.md, spec.md (+ Clarifications), research.md (D1–D7), data-model.md, contracts/i18n-api.md, quickstart.md

**Tests**: Not full TDD. Per research D7 the plan calls for three lightweight guards — TypeScript key-parity (compile-time), a residual-CJK scan, and one English-mode E2E smoke. Those specific verification tasks are included; no other test tasks are generated.

**Organization**: Tasks are grouped by user story. The language plumbing (`SettingsContext` persistence + default + `SettingsSheet` toggle) **already exists**; these tasks build the catalog/accessor and migrate the ~233 hardcoded zh strings through it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (maps to spec.md user stories)
- All paths are repo-relative; PWA source lives under `pwa/`.

**Shared-file note**: every migration task appends keys to the single pair `pwa/src/i18n/zh.ts` + `pwa/src/i18n/en.ts` (per plan D2). Tasks that both edit the catalog are therefore **not** marked `[P]` even though their component edits are logically independent — they serialize on those two files.

---

## Phase 1: Setup (i18n module scaffold)

**Purpose**: Stand up the catalog + accessor that every later task depends on.

- [X] T001 Create `pwa/src/i18n/zh.ts` as the base catalog: `export const zh = { ... }` seeded with shared `common.*` keys (e.g. `common.loading` = `載入中…`, plus save/cancel/confirm/delete/edit/close/back/retry as encountered). Also export `export type Messages = typeof zh;` and `export type MessageKey = keyof Messages;`. Do **not** use `as const` (values must stay `string`).
- [X] T002 Create `pwa/src/i18n/en.ts`: `import type { Messages } from './zh'; export const en: Messages = { ... }` with the matching English `common.*` strings. The `Messages` annotation makes a missing/renamed key a compile error (coverage guard).
- [X] T003 Implement `pwa/src/i18n/index.ts` (depends on T001, T002): `catalog = { zh, en }`; `interpolate(raw, params)` doing `{name}` → value replacement; `translate(lang, key, params?)` with the fallback chain `catalog[lang][key] ?? catalog.zh[key] ?? key` then interpolate; `useT()` hook = `const { lang } = useSettings(); return useMemo(() => (k, p) => translate(lang, k, p), [lang])`; re-export `Messages`, `MessageKey`, `Params`. Matches `contracts/i18n-api.md`.

**Checkpoint**: `useT()` is importable and resolves keys with zh→key fallback.

---

## Phase 2: Foundational (app shell + shared vocabulary)

**Purpose**: Prove the pipeline on the always-present shell and seed the shared `nav.*`/`settings.*`/`common.*` vocabulary every story reuses.

**⚠️ Blocks all user stories** — every screen renders inside this shell.

- [X] T004 Migrate `pwa/src/App.tsx`: move the inline `NAV_LABELS` into the catalog as `nav.entry`/`nav.summary`/`nav.budget`/`nav.import`/`nav.settings`, consume them via `useT()` in `NavBar`, and replace the Suspense fallback literal `載入中…` with `t('common.loading')`. Add the `nav.*` keys (verbatim zh) to `pwa/src/i18n/zh.ts` + English to `pwa/src/i18n/en.ts`.
- [X] T005 Migrate `pwa/src/components/SettingsSheet.tsx` chrome to `t()`: `設定 / Settings`→`settings.title`, `語系 / Language`→`settings.language`, `主題 / Theme`→`settings.theme`, `☀️ 淺色`→`settings.themeLight`, `🌙 深色`→`settings.themeDark`; the `中文`/`English` toggle labels stay as language self-names (key as `settings.langZh`/`settings.langEn`). Add keys to both catalogs.

**Checkpoint**: toggling language in Settings re-labels the nav, settings sheet, and loading state live.

---

## Phase 3: User Story 1 - Switch language and have it stick (Priority: P1) 🎯 MVP

**Goal**: The user switches language and the primary add-expense screen + shell update immediately, persist across restart, and restore the exact original zh wording when switched back.

**Independent Test**: On the Entry screen, toggle `中文`↔`English` — UI updates with no reload and in-progress input is kept; reload the app and confirm the choice persists; switch back and confirm zh wording is identical to today.

- [X] T006 [US1] Migrate `pwa/src/screens/EntryScreen.tsx` (~31 zh lines): replace every static chrome literal with `t('entry.*')`, using `t(key, { ... })` for strings that embed values. Add the `entry.*` keys verbatim to `pwa/src/i18n/zh.ts` and English to `pwa/src/i18n/en.ts`. Leave any API/DB-derived text (category/description values) untranslated.
- [X] T007 [US1] Migrate the components EntryScreen renders on the add path to `t()` — for each file EntryScreen imports (e.g. `pwa/src/components/CategoryPicker.tsx`, `pwa/src/components/PaymentPills.tsx`, `pwa/src/components/TagInput.tsx`, `pwa/src/components/DescriptionSuggest.tsx`), replace chrome literals and add `entry.*`/`common.*` keys to both catalogs. (Components shared with other screens but first reached here are migrated now; later phases only add missing keys.)
- [ ] T008 [US1] Verify the US1 loop end-to-end: language toggle updates EntryScreen + nav instantly (no reload, input preserved), the choice persists across an app reload via existing `localStorage['lang']`, and switching back to `中文` restores exact wording. Run the existing default-zh E2E (`cd e2e && pnpm test`) to confirm no regression.

**Checkpoint**: MVP — language switch observably works on the core flow and persists. Deployable.

---

## Phase 4: User Story 2 - Complete, faithful coverage (Priority: P2)

**Goal**: Every remaining screen and dialog is fully bilingual with no zh chrome leaking in English mode, and zh wording is unchanged from today.

**Independent Test**: Set language to English and walk every screen/dialog — no residual zh chrome; set to `中文` and confirm wording matches the pre-feature app exactly.

> Migration tasks T009–T013 all append to `pwa/src/i18n/zh.ts` + `en.ts`, so they run sequentially (not `[P]`).

- [ ] T009 [US2] Migrate the Summary area: `pwa/src/screens/SummaryScreen.tsx` (~20), `pwa/src/components/SummaryNav.tsx`, `pwa/src/components/FilterBar.tsx`, `pwa/src/components/PeriodPicker.tsx`, and chrome strings in `pwa/src/hooks/useSummary.ts`. Translate UI labels only; leave DB-derived category/label **data** values untouched (spec Q1). Add `summary.*` keys to both catalogs.
- [ ] T010 [US2] Migrate `pwa/src/screens/BudgetScreen.tsx` (~6) chrome to `t()`; add `budget.*` keys to both catalogs.
- [ ] T011 [US2] Migrate the Import area: `pwa/src/screens/ImportScreen.tsx` (~49, heaviest), `pwa/src/components/AmbiguousInvoiceCard.tsx`, `pwa/src/components/ManualLinkSheet.tsx`. Add `import.*` keys to both catalogs; use interpolation for count/amount strings.
- [ ] T012 [US2] Migrate the edit/detail area: `pwa/src/components/EditExpenseSheet.tsx` (~19), `pwa/src/components/EditHistorySection.tsx`, `pwa/src/components/AdjustmentRow.tsx`, `pwa/src/components/ItemRow.tsx`. Add `edit.*`/`common.*` keys to both catalogs.
- [ ] T013 [US2] Migrate remaining components: `pwa/src/components/ItemCategorySheet.tsx`, `pwa/src/components/ParentSearch.tsx`, `pwa/src/components/ApiKeyPrompt.tsx`, `pwa/src/components/BottomSheet.tsx`, and review `pwa/src/lib/itemCategory.ts` — migrate chrome, but **leave category-name data values as-is** (spec Q1). Add any missing keys to both catalogs.
- [ ] T014 [P] [US2] Add the residual-CJK scan: create `pwa/scripts/check-i18n-coverage.sh` (greps CJK literals in `pwa/src` excluding `pwa/src/i18n/`, with an allowlist for intentional DB-data lines from T009/T013) and wire it as `i18n:check` in `pwa/package.json`. (New files only → parallel with the migration tasks.)
- [ ] T015 [US2] Run the coverage guards and close any gaps: `cd pwa && pnpm exec tsc --noEmit` passes (en key parity), `pnpm run i18n:check` returns only allowlisted lines, and a visual pass confirms zh wording is unchanged. Fix leaks until clean.

**Checkpoint**: full bilingual coverage; zh visually identical to today; English leak-free.

---

## Phase 5: User Story 3 - Sensible default for first-time/returning users (Priority: P3)

**Goal**: A user with no stored choice sees zh (today's experience unchanged); a stored choice is honored; an unrecognized stored value falls back to zh.

**Independent Test**: Clear `localStorage['lang']` and open the app → zh. Set it to `en` → opens in English. Set it to garbage → falls back to zh.

- [ ] T016 [US3] Harden language resolution in `pwa/src/context/SettingsContext.tsx`: validate the stored `localStorage['lang']` against the supported codes and fall back to `'zh'` when the value is absent or unrecognized (FR-005, spec Edge Case). Keep default `'zh'`; do **not** add browser/device auto-detection.
- [ ] T017 [US3] Verify resolution: fresh state (no `lang` key) opens in zh; stored `en` is honored on load; an invalid stored value falls back to zh. (Manual via devtools localStorage; existing default-zh E2E continues to pass.)

**Checkpoint**: first-run and stored-preference resolution locked to spec.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Real-browser regression guard and final verification.

- [ ] T018 [P] Add an English-mode E2E smoke in `e2e/tests/i18n-language.spec.ts`: seed `localStorage['lang']='en'` before load, then assert a known label renders in English (e.g. nav "Entry"). Leave the existing default-zh specs untouched.
- [ ] T019 Run the full `quickstart.md` verification: `pnpm exec tsc --noEmit`, `pnpm run i18n:check`, and `cd e2e && pnpm test` (zh default + en smoke) all green.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: T001 → T002 → T003 (T003 needs both catalogs). No earlier deps.
- **Foundational (Phase 2)**: needs Phase 1. Blocks all user stories.
- **US1 (Phase 3)**: needs Phase 2. This is the MVP.
- **US2 (Phase 4)**: needs Phase 2 (independent of US1, but in practice follows it). T014 may run anytime after Phase 1.
- **US3 (Phase 5)**: needs Phase 1 only (touches `SettingsContext`); independent of US1/US2. Sequenced last by priority.
- **Polish (Phase 6)**: T018 after Phase 2 (needs a translated label); T019 after all desired stories.

### Within stories

- Migration tasks that touch `pwa/src/i18n/zh.ts` + `en.ts` serialize on those files.
- Each migration: add keys to both catalogs → replace literals at call sites → keep zh verbatim.

### Parallel opportunities

- This is a single-developer personal tool; parallelism is mostly informational.
- `[P]` tasks (different/new files, no catalog edit): T014 (scan script + package.json) and T018 (new e2e spec) can run alongside the migration work.

---

## Implementation Strategy

### MVP first (Setup + Foundational + US1)

1. Phase 1 (T001–T003): catalog + `useT()`.
2. Phase 2 (T004–T005): shell + shared vocabulary.
3. Phase 3 (T006–T008): Entry flow migrated; switch/persist verified.
4. **STOP & VALIDATE**: language switch works end-to-end on the core screen → deployable MVP.

### Incremental delivery

1. MVP (above).
2. US2 (T009–T015): full coverage + guards → no-leak bilingual app.
3. US3 (T016–T017): resolution hardening.
4. Polish (T018–T019): en E2E smoke + full verification.

---

## Notes

- `[P]` = different files, no dependency on an incomplete task.
- Keep zh strings **verbatim** when extracting (FR-008) — the default experience must not visibly change.
- Never key DB-sourced content (category/subcategory names, descriptions, autocomplete, imported data) — spec Q1 / FR-009.
- The fallback chain (`selected → zh → key`) means a missing key is never blank/broken (FR-007); TS parity should prevent it ever triggering.
- Commit after each task or logical group (handled by the spec-kit auto-commit hook).
