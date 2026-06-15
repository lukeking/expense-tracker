# Quickstart: Multilingual (i18n) Support

**Feature**: 029-multilingual-i18n | **Date**: 2026-06-15

How to work with the i18n module once it lands. All paths are under `pwa/`.

## Translate a string in a component

```tsx
import { useT } from '../i18n';

function Example() {
  const t = useT();
  return <button>{t('entry.submit')}</button>;
}
```

With an interpolated value:

```tsx
const t = useT();
<span>{t('summary.selectedCount', { n: selected.length })}</span>
// catalog: zh → '已選 {n} 項'   en → '{n} selected'
```

## Add a new message key

1. Add the key + **verbatim** current zh string to `src/i18n/zh.ts`.
2. Add the same key with the English string to `src/i18n/en.ts`.
3. Use `t('your.key')` at the call site.

If you add the key only to `zh.ts`, `tsc`/`vite build` will fail on `en.ts` until you add the English string — that's the coverage guard working.

## Switch language (manual check)

- In the app: tap ⚙️ → **語系 / Language** → toggle `中文` / `English`. The whole UI updates immediately (no reload); your in-progress input stays intact. The choice persists in `localStorage['lang']`.
- Default with no stored choice is `中文` (zh). No browser auto-detection.

## Add a whole new language (future)

1. Add the code to the `Lang` union in `src/context/SettingsContext.tsx` (e.g. `'ja'`).
2. Create `src/i18n/ja.ts` as `const ja: Messages = { ... }` — TypeScript lists every key you still owe.
3. Register it in the catalog map in `src/i18n/index.ts` and add its label to the `SettingsSheet` toggle.

No screen or component changes are required (FR-010 / SC-005).

## Verify coverage & no leaks

```bash
# 1. Compile-time key parity (en must define every zh key)
cd pwa && pnpm exec tsc --noEmit        # or: pnpm build

# 2. Residual hardcoded CJK chrome outside the catalog (should be empty,
#    aside from any intentional DB-data literals allowlisted during extraction)
grep -rnP '[\x{4e00}-\x{9fff}]' src --include='*.tsx' --include='*.ts' \
  | grep -v '^src/i18n/'

# 3. End-to-end (existing feature-028 Playwright harness)
#    Default runs exercise zh; the English-mode smoke sets localStorage lang='en'.
cd ../e2e && pnpm test
```

Expected:
- `tsc --noEmit` passes (no missing/renamed keys).
- The grep returns only allowlisted DB-data lines (no chrome leaks).
- E2E green in both zh (default) and the en smoke.

## Definition of done (maps to spec Success Criteria)

- Toggle flips the entire visible UI between zh and en in-session, no reload — **SC-001**.
- English mode shows no residual zh chrome; zh mode matches the pre-feature wording exactly — **SC-002**.
- Choice survives a close/reopen — **SC-003** (already provided by `localStorage['lang']`).
- Fresh state opens in zh — **SC-004**.
- A new language needs only one new catalog — **SC-005**.
- Category names / descriptions / imported data look identical in both languages — **SC-006**.
