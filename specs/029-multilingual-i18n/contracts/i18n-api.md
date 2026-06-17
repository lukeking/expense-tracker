# Contract: i18n Module Public Interface

**Feature**: 029-multilingual-i18n | **Date**: 2026-06-15

This is a front-end UI feature; the "contract" is the public surface of `pwa/src/i18n/` that every component depends on. Keeping this surface small and stable is what lets the catalog grow without touching call sites.

## Module: `pwa/src/i18n/index.ts`

### Types

`Messages` / `MessageKey` are declared **in `zh.ts`** (next to the base catalog) so that
`en.ts` can `import type { Messages } from './zh'` without creating an `index ↔ en`
import cycle (`index.ts` imports the `en` *value*). `index.ts` re-exports them.

```ts
// pwa/src/i18n/zh.ts — base catalog is the single source of truth for the key set
export const zh = { /* 'common.loading': '載入中…', ... */ };
export type Messages = typeof zh;
export type MessageKey = keyof Messages;

// pwa/src/i18n/index.ts — re-export the types + the params shape
export type { Messages, MessageKey } from './zh';
export type Params = Record<string, string | number>;
```

### `useT()` — primary component API

```ts
export function useT(): (key: MessageKey, params?: Params) => string;
```

- Reads `lang` from `useSettings()` and returns a memoized translator bound to the current language.
- Re-renders the calling component when `lang` changes (reactive switch, FR-003).
- **Usage**: `const t = useT(); ... <button>{t('entry.submit')}</button>`

### `translate()` — non-hook escape hatch

```ts
export function translate(lang: Lang, key: MessageKey, params?: Params): string;
```

- For the rare non-component call site (utilities). Components should prefer `useT()`.

### Resolution & fallback (normative)

1. Look up `catalog[lang][key]`.
2. If absent, fall back to `catalog['zh'][key]` (FR-007).
3. If still absent, return the `key` string itself — **never** an empty string, raw `undefined`, or a thrown error.
4. Replace `{name}` placeholders in the result with `params.name` (string-coerced). Unreferenced placeholders are left as-is; missing params leave the token untouched.

### Catalog contract

- `pwa/src/i18n/zh.ts` exports `zh` — the base catalog, the source of truth for `MessageKey`. Values are the **verbatim** current zh-TW strings (FR-008).
- `pwa/src/i18n/en.ts` does `import type { Messages } from './zh'` and exports `en` typed as `const en: Messages` — guarantees **key parity** with zh at compile time (SC-002). A missing/renamed key fails the build.
- Keys are dotted-namespace strings grouped by area: `common.*`, `entry.*`, `summary.*`, `budget.*`, `import.*`, `settings.*` (+ component-scoped groups as needed).
- **Only static UI chrome** belongs in the catalog; DB-sourced display content must not be keyed (FR-009).

## Consumer contract (every screen/component)

- Replace each hardcoded chrome literal with `t('<key>')` (or `t('<key>', { ... })` for interpolated strings).
- Do **not** read `lang` to branch on text manually — route all text through `t()` so coverage stays centralized and checkable.
- Do **not** translate values that originate from the API/DB (category names, descriptions, imported data).

## Verification hooks (see quickstart.md)

- **Compile-time**: `tsc` / `vite build` fails if `en` is missing any `MessageKey` (coverage guard).
- **Residual-CJK scan**: flags CJK literals left in `pwa/src` outside `pwa/src/i18n/` (leak guard).
- **E2E smoke**: Playwright sets `localStorage['lang']='en'` and asserts an English label renders.
