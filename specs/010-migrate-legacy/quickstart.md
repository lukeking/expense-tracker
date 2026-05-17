# Quickstart: Legacy Accounting Data Migration

## Prerequisites

- `backend/.env` with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set
- NaggingMoney CSV export in the repo root: `NaggingMoney_20260516082424_utf8.csv`
- Migration `009_add_source_to_transactions.sql` applied to the database

## Step 1: Apply the DB Migration

Run migration `008` in the Supabase dashboard SQL editor or via CLI:

```sql
-- backend/supabase/migrations/009_add_source_to_transactions.sql
ALTER TABLE transactions ADD COLUMN source TEXT;
CREATE INDEX idx_transactions_source ON transactions (source) WHERE source IS NOT NULL;
```

## Step 2: Dry Run (Recommended First Step)

```bash
cd backend
npx tsx scripts/migrate-legacy.ts --dry-run ../NaggingMoney_20260516082424_utf8.csv
```

Open the generated `dry-run-YYYYMMDD-HHMMSS.txt` and verify:
- All 9 categories are mapped with zero unmapped failures
- Sample rows look correct (date, amount, tags, note)
- `Would insert` count matches expectation (~15,203 rows)
- No unexpected parse failures

Adjust the category mapping in `migrate-legacy.ts` if needed and re-run.

## Step 3: Full Import

```bash
cd backend
npx tsx scripts/migrate-legacy.ts ../NaggingMoney_20260516082424_utf8.csv
```

Watch the batch progress. On completion, verify the summary shows:
- `Imported: ~15,197` (expenses)
- `Income (refund): 6`
- `Deduplicated: 0`
- `Parse failures: 0`

## Step 4: Verify in Discord

Run `/summary all` in Discord and confirm:
- Total spend for historical period appears in the output
- Category breakdown shows expected proportions (食 should dominate)
- No `其他` spike that would indicate unmapped category tags

## Re-running

The script is safe to re-run. Any row already in the database with `source = 'legacy_migration'` and matching `(amount, transaction_at, note)` will be skipped and counted as `Deduplicated`.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing SUPABASE_URL` | .env not loaded | Ensure `backend/.env` exists and has the key |
| High parse failure count | CSV encoding issue | Confirm the file is UTF-8 (the `_utf8` filename suffix indicates it should be) |
| Large `其他` in summary | Unmapped category tag | Check dry-run report for unmapped category values; update mapping config |
| Script exits with code 1 | DB connection failed or migration not applied | Run Step 1 first; check Supabase project status |
