# CLI Contract: migrate-legacy

**Script**: `backend/scripts/migrate-legacy.ts`  
**Invocation**: `cd backend && npx tsx scripts/migrate-legacy.ts [options] <csv-path>`

## Arguments

| Argument | Required | Description |
|---|---|---|
| `<csv-path>` | Yes | Path to the NaggingMoney UTF-8 CSV file |

## Options

| Flag | Type | Default | Description |
|---|---|---|---|
| `--dry-run` | boolean | false | Parse and map all rows, write preview to file, make no DB writes |
| `--batch-size <n>` | integer | 100 | Number of rows per insert batch |

## Environment Variables (via `backend/.env`)

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key for direct DB access |

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Completed successfully (all rows processed, summary printed) |
| 1 | Fatal error: missing env vars, file not found, or unrecoverable parse failure |

## Terminal Output (non-dry-run)

```
[migrate-legacy] Starting import: NaggingMoney_20260516082424_utf8.csv
[migrate-legacy] Loading dedup index... 0 existing legacy records found
[migrate-legacy] Batch 1/153 (rows 1–100)... done
...
[migrate-legacy] Batch 153/153 (rows 15201–15203)... done

=== Import Complete ===
Total rows read:      17221
  Skipped (type 99):  2018
  Imported:          15197
  Income (refund):       6
  Deduplicated:          0
  Parse failures:        0
  Non-TWD flagged:       0
```

## Terminal Output (dry-run)

```
[migrate-legacy] Dry run: NaggingMoney_20260516082424_utf8.csv
[migrate-legacy] Processing 17221 rows...
[migrate-legacy] Dry run complete — see dry-run-20260516-143022.txt
```

## Example Invocations

```bash
# Dry run (preview only, no DB writes)
cd backend && npx tsx scripts/migrate-legacy.ts --dry-run ../NaggingMoney_20260516082424_utf8.csv

# Full import
cd backend && npx tsx scripts/migrate-legacy.ts ../NaggingMoney_20260516082424_utf8.csv

# Full import with smaller batch size
cd backend && npx tsx scripts/migrate-legacy.ts --batch-size 50 ../NaggingMoney_20260516082424_utf8.csv
```
