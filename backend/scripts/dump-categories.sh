#!/usr/bin/env bash
# Dump the live `categories` table to backend/supabase/seed/categories.md.
#
# The category catalog is DB-managed (not migration-driven): migrations 011/012 are
# only the initial seed, scripts/migrate-legacy.ts upserted the rest, plus manual
# Supabase curation. So the live DB is the source of truth, and this snapshot is its
# git-tracked record. Re-run after changing the catalog.
#
# Usage:
#   pnpm dev                                   # in another terminal (serves the worker on :8787)
#   ./scripts/dump-categories.sh               # uses http://localhost:8787
#   API_BASE=https://your.worker.example ./scripts/dump-categories.sh
#
# Requires: curl, jq, and ANDROID_API_KEY present in backend/.dev.vars.
# The key is loaded at runtime and never printed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"
DEV_VARS="$BACKEND_DIR/.dev.vars"
OUT="$BACKEND_DIR/supabase/seed/categories.md"
API_BASE="${API_BASE:-http://localhost:8787}"

command -v jq   >/dev/null || { echo "dump-categories: 'jq' is required" >&2; exit 1; }
command -v curl >/dev/null || { echo "dump-categories: 'curl' is required" >&2; exit 1; }
[ -f "$DEV_VARS" ]         || { echo "dump-categories: missing $DEV_VARS" >&2; exit 1; }

KEY="$(grep -E '^ANDROID_API_KEY=' "$DEV_VARS" | head -1 | cut -d= -f2- | tr -d '"'"'"'\r')"
[ -n "$KEY" ] || { echo "dump-categories: ANDROID_API_KEY not found in $DEV_VARS" >&2; exit 1; }

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# Write to a temp first; on any failure (e.g. 401, worker down) the existing snapshot
# is left untouched rather than clobbered with a partial/error body.
{
  cat <<'HDR'
<!--
Snapshot of the live `categories` table — the source of truth for the catalog.
(Categories are DB-managed; migrations 011/012 are only the initial seed.)
Regenerate: backend/scripts/dump-categories.sh  (needs `pnpm dev` running).
-->

Major | Sub | Order
--- | --- | ---
HDR
  curl -fsS -H "Authorization: Bearer $KEY" "$API_BASE/pwa/categories" \
    | jq -r '.categories[] | "\(.major) | \(.subcategory // "NULL") | \(.sort_order)"' \
    | sort
} > "$TMP"

mv "$TMP" "$OUT"
trap - EXIT

rows="$(awk '/^--- \| /{f=1; next} f && /\|/ {c++} END {print c+0}' "$OUT")"
echo "dump-categories: wrote $OUT ($rows category rows)"
