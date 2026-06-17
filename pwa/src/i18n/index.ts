import { useMemo } from 'react';
import { useSettings } from '../context/SettingsContext';
import type { Lang } from '../context/SettingsContext';
import { zh } from './zh';
import { en } from './en';
import type { Messages, MessageKey } from './zh';

export type { Messages, MessageKey } from './zh';
export type Params = Record<string, string | number>;

const catalog: Record<Lang, Messages> = { zh, en };

// Replace {name} tokens with params.name; leave unreferenced/missing tokens untouched.
function interpolate(raw: string, params?: Params): string {
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, key) => (key in params ? String(params[key]) : match));
}

// Resolve a key for a language: selected → zh base → key itself (never blank/broken, FR-007).
export function translate(lang: Lang, key: MessageKey, params?: Params): string {
  const raw = catalog[lang][key] ?? catalog.zh[key] ?? key;
  return interpolate(raw, params);
}

// Component accessor — re-renders the caller when `lang` changes (reactive switch, FR-003).
export function useT(): (key: MessageKey, params?: Params) => string {
  const { lang } = useSettings();
  return useMemo(() => (key: MessageKey, params?: Params) => translate(lang, key, params), [lang]);
}
