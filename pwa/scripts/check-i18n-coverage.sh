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
set -euo pipefail
cd "$(dirname "$0")/.."   # -> pwa/

hits=$(grep -rnP '[\x{4e00}-\x{9fff}]' src --include='*.tsx' --include='*.ts' \
  | grep -v '^src/i18n/' \
  | grep -vE "MONTH_NAMES|MONTH_LABELS|label: '全部'|EXPLICIT_UNCATEGORIZED|explicit-uncategorized|OTHER_SUBCATEGORY" \
  || true)

if [ -n "$hits" ]; then
  echo "✗ Untranslated CJK found outside the i18n catalog (route it through useT()):"
  echo "$hits"
  exit 1
fi
echo "✓ i18n coverage: no untranslated CJK UI strings outside src/i18n."
