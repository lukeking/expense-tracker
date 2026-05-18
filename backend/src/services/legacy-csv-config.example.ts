// Copy this file to legacy-csv-config.ts (gitignored) and fill in your own rules.
// This file shows the shape — the actual data stays off-version-control.
import type { BeizhuRule } from './legacy-csv-parser';

// Maps raw 備註 strings to disambiguation rules.
// tag: plain tag appended to the transaction (institution name, brand, etc.)
// note: replaces the default noteText (clarifying description)
// items: explicit named-amount breakdown (overrides parseBeiZhuItems auto-detection)
// Empty object {}: suppresses tag creation without overriding the note.
export const BEIZHU_RULES: Record<string, BeizhuRule> = {
  // example: '某某診所 感冒': { tag: '某某診所', note: '感冒' },
  // example: '待請款': {},
  // example: '岸潛x2 1800 裝備 1000': { items: [{ name: '岸潛x2', amount: 1800 }, { name: '裝備', amount: 1000 }] },
};

// Normalises NaggingMoney subcategory naming variants to canonical forms.
export const SUBCATEGORY_REMAP: Record<string, string> = {
  // example: '剪髮': '理髮',
};

// Fixes misclassified category:sub tags produced by the raw category map.
// key: the wrong tag; value: replacement tag(s).
export const TAG_CORRECTIONS: Record<string, string[]> = {
  // example: '行:某App': ['其他:App', '某App'],
};
