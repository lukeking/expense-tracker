# Phase 1 Data Model: Multilingual (i18n) Support

**Feature**: 029-multilingual-i18n | **Date**: 2026-06-15

This feature has **no database schema**. The "data" is client-side: a bundled message catalog and a persisted language preference. Entities below describe the in-app structures and their invariants.

## Entity: SupportedLanguage

A language the app can display.

| Field | Type | Notes |
|-------|------|-------|
| `code` | `'zh' \| 'en'` | Stable identifier. `zh` ≡ Traditional Chinese (zh-TW); `en` ≡ English. Matches the existing `Lang` type in `SettingsContext`. |
| `label` | string | Human-readable name shown in the language toggle (`中文`, `English`). |

- **Set is closed and extensible**: adding a language means adding a `code` to the `Lang` union and shipping a matching catalog (FR-010). No per-screen change.
- **Base language**: `zh` is the source-of-truth catalog; all other catalogs are typed against it.

## Entity: MessageCatalog

The complete set of UI strings for one language.

| Field | Type | Notes |
|-------|------|-------|
| (keys) | dotted-namespace strings | e.g. `entry.submit`, `import.uploadCsv`, `common.loading`, `settings.language`. |
| (values) | string | The display text; may contain `{name}` placeholders for interpolation (D3). |

- **Type**: `Messages = typeof zhCatalog`; `MessageKey = keyof Messages`.
- **Parity invariant**: `const en: Messages = { ... }` — every catalog MUST define exactly the `MessageKey` set, enforced at compile time (supports SC-002). A missing or misspelled key is a build error.
- **zh values invariant**: extracted verbatim from the current source so the default experience is byte-for-byte unchanged (FR-008).
- **Scope invariant**: keys cover **static UI chrome only** — titles, nav, buttons, labels, placeholders, validation/error messages, empty states, confirmations/toasts. DB-sourced display content (category/subcategory names, descriptions, autocomplete, imported data) is **never** a catalog key (FR-009, spec Q1).

## Entity: LanguagePreference

The user's chosen language, resolved at startup.

| Field | Type | Notes |
|-------|------|-------|
| storage key | `localStorage['lang']` | **Already exists** — no new mechanism. |
| value | `'zh' \| 'en'` | Persisted on every `setLang` (FR-002). |
| default | `'zh'` | Used when the key is absent (FR-005); **no** browser/device auto-detection (spec Q3). |

- **Resolution order**: stored value → default `zh`.
- **Unsupported stored value** (e.g. a removed language): falls back to default `zh` (spec Edge Case).
- **Per-device**: client-only; not synced to any backend account (spec Assumptions).

## Resolution & fallback logic (runtime contract)

```
translate(lang, key, params?):
  raw = catalog[lang][key]          # selected language
       ?? catalog['zh'][key]        # FR-007 fallback to base
       ?? key                       # last-resort safety (never blank/broken)
  return interpolate(raw, params)   # replace {name} tokens (D3)
```

- With the compile-time parity invariant, the `catalog['zh'][key]` fallback is a runtime safety net, not an expected path.
- `interpolate` does plain `{name}` → `params.name` substitution; no pluralization (D3).

## State transitions

Only one user-driven transition exists; it is presentational and loss-free.

```
[lang = zh] --user selects English in SettingsSheet--> [lang = en]
   • setLang('en') persists to localStorage['lang']
   • all useT() consumers re-render in the same pass (no reload)
   • in-progress form input is preserved (FR-003)
[lang = en] --user selects 中文--> [lang = zh]   (symmetric; exact original wording restored)
```
