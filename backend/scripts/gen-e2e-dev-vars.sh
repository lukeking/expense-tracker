#!/usr/bin/env bash
# Generates backend/.dev.vars.e2e (gitignored) for `wrangler dev --env e2e`.
#
# Pulls the local Supabase service-role key from `supabase status` at runtime, so no
# key is ever committed or printed. Run from backend/ after `supabase start`.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=.dev.vars.e2e
{
  echo "SUPABASE_URL=http://127.0.0.1:54321"
  pnpm exec supabase status -o env \
    | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"$/SUPABASE_SERVICE_ROLE_KEY=\1/p'
  echo "ANDROID_API_KEY=e2e-test-key"
  echo "PWA_ORIGIN=http://localhost:5300"
} > "$OUT"

if ! grep -q '^SUPABASE_SERVICE_ROLE_KEY=' "$OUT"; then
  echo "ERROR: could not read SERVICE_ROLE_KEY from 'supabase status' — is the stack running?" >&2
  exit 1
fi
echo "Wrote $OUT (service-role key pulled from supabase status; not printed)."
