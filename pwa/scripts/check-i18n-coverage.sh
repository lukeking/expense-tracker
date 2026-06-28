#!/usr/bin/env bash
# Feature 029 (i18n) coverage guard.
# Fails if any untranslated CJK UI string remains in pwa/src outside the i18n catalog.
#
# Allowlisted (intentionally not translated):
#   - Date-format month labels (MONTH_NAMES / MONTH_LABELS) — spec Q2 keeps current
#     date/number formatting in both languages.
#   - The all-time period label ('全部') returned by timeBaseToRange (never displayed;
#     the nav row is hidden in all-time mode) — spec Q2.
#   - EXPLICIT_UNCATEGORIZED ('其他:未分類') and the 'Other' bucket value it derives —
#     a data sentinel that must mirror the backend, not UI chrome — spec Q1.
#   - OTHER_SUBCATEGORY ('其他') in lib/subcategory.ts — the same 'Other' bucket sentinel,
#     compared against the backend's subcategory label (feature 030), not UI chrome.
#   - UNCATEGORIZED ('未分類') — the 未分類 bucket value, mirrored from the backend
#     (feature 031); a data sentinel, not UI chrome. The '待分類' chrome is i18n'd.
#
# Not flagged:
#   - Comments. CJK in // line comments and /* */ blocks is documentation, never shipped
#     UI, so comment lines are skipped (this guard is about untranslated UI *strings*).
#   - Any line carrying an `i18n-allow` marker — an explicit escape hatch for legitimate
#     CJK in code that is NOT UI chrome (e.g. MAJOR_ICONS, keyed by the DB's Chinese
#     category names). Add the marker only when the CJK mirrors backend/DB data.
set -euo pipefail
cd "$(dirname "$0")/.."   # -> pwa/

hits=$(grep -rnP '[\x{4e00}-\x{9fff}]' src --include='*.tsx' --include='*.ts' \
  | grep -v '^src/i18n/' \
  | grep -vE ':[0-9]+:[[:space:]]*(//|/?\*)' \
  | grep -vE "MONTH_NAMES|MONTH_LABELS|label: '全部'|EXPLICIT_UNCATEGORIZED|explicit-uncategorized|OTHER_SUBCATEGORY|UNCATEGORIZED|i18n-allow" \
  || true)

if [ -n "$hits" ]; then
  echo "✗ Untranslated CJK found outside the i18n catalog (route it through useT()):"
  echo "$hits"
  exit 1
fi
echo "✓ i18n coverage: no untranslated CJK UI strings outside src/i18n."
