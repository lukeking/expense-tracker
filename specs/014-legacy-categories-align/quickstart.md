# Quickstart: Legacy Category Curation & Migration

**Feature**: 014-legacy-categories-align  
**Date**: 2026-05-20

---

## Prerequisites

- `backend/.env` has valid `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- NaggingMoney CSV is available (e.g., `NaggingMoney_20260516082424_utf8.csv`)
- DB is in clean state: `categories` table seeded (migration 011), `transactions` empty
- Working directory: `backend/`

---

## Step 1 — Implement Subcategory Frequency Table in Dry-Run

Apply the code change to `scripts/migrate-legacy.ts`:

- In `writeDryRunFile`: after the existing "Category coverage" block, add a "Subcategory breakdown" section that iterates `rows`, extracts all `major:subcategory` tags (regex `/^[^:]+:[^:]+$/`), accumulates counts, sorts descending, and writes to the report file.
- In `main` (dry-run branch): collect unique `major:subcategory` pairs from `rows` and include a "would create categories: N" section with the full list.
- In `main` (live branch): before the batch loop, upsert all collected `major:subcategory` pairs into the `categories` table using `ON CONFLICT DO NOTHING`.

---

## Step 2 — First Dry-Run: Get Baseline Category Inventory

```bash
cd backend
npx tsx scripts/migrate-legacy.ts --dry-run ../NaggingMoney_20260516082424_utf8.csv
```

Open the generated `dry-run-*.txt`. The new "Subcategory breakdown" section lists every `major:subcategory` the parser would produce, sorted by frequency. This is the baseline — expect 100+ distinct entries before curation.

---

## Step 3 — Iterative Curation

Review the subcategory breakdown and make decisions. Common patterns:

**Merge overly specific subcategories** → add to `SUBCATEGORY_REMAP`:
```typescript
// legacy-csv-config.ts
export const SUBCATEGORY_REMAP: Record<string, string> = {
  // existing...
  '某個太細的子類別': '更廣的子類別',
};
```

**Reclassify misplaced categories** → add/update `TAG_CORRECTIONS`:
```typescript
export const TAG_CORRECTIONS: Record<string, string[]> = {
  // existing...
  '其他:某個項目': ['食:更正確的類別'],
};
```

**Resolve seed conflicts** (計程車 vs 搭計程車, 油費 vs 加油費, 租金 vs 房租):
- Decide which name to use
- Either update `SUBCATEGORY_REMAP` to produce the seed name, or plan to update the SQL migration to use the parser name
- See `plan.md §Known Curation Decision Points`

After each change, re-run dry-run and check the updated subcategory list:
```bash
npx tsx scripts/migrate-legacy.ts --dry-run ../NaggingMoney_20260516082424_utf8.csv
```

Repeat until the subcategory list reflects the intended taxonomy.

---

## Step 4 — Write the SQL Migration

From the final dry-run output, create `backend/supabase/migrations/012_legacy_categories.sql`.

Include:
1. `(major, NULL)` rows for `其他` and `衣` (and any other missing majors)
2. All curated `(major, subcategory)` pairs not already in the 011 seed
3. All statements use `ON CONFLICT DO NOTHING`

Sort order: for each major, start at `(highest existing sort_order) + 10`, increment by 10, ordered by descending frequency from the final dry-run.

Apply to DB:
```bash
# Option A: supabase CLI
npx supabase db push

# Option B: direct SQL via psql or Supabase dashboard SQL editor
```

---

## Step 5 — Run the Data Migration

```bash
cd backend
npx tsx scripts/migrate-legacy.ts ../NaggingMoney_20260516082424_utf8.csv
```

Expected terminal output:
```
[migrate-legacy] Starting import: NaggingMoney_20260516082424_utf8.csv
[migrate-legacy] Loading dedup index...
[migrate-legacy] Dedup index loaded: 0 existing legacy records
[migrate-legacy] Batch 1/NNN...
...
=== Import Complete ===
Total rows read:        17XXX
  Skipped (type-99):    ~2018
  Imported (expense):   ~15200
  Imported (income→refund): ~6
  Deduplicated:         0
  Parse failures:       (small number)
  Non-TWD flagged:      (small number)
  Unmapped categories:  (should be empty after curation)
  Unmapped accounts:    (small number, expected)
```

---

## Step 6 — Verify

```sql
-- Should return 0 rows (every legacy tag has a matching category)
SELECT DISTINCT unnest(tags) AS tag
FROM transactions
WHERE source = 'legacy_migration'
  AND unnest(tags) ~ '^[^:]+:[^:]+$'
  AND NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.major = split_part(unnest(tags), ':', 1)
      AND c.subcategory = split_part(unnest(tags), ':', 2)
  );
```

Check PWA category picker: open → select `其他` → verify subcategories appear. Check summary → "全部" → drill into `其他` → verify subcategory groups.

---

## Re-run Safety

Both migrations are idempotent:
- `012_legacy_categories.sql` uses `ON CONFLICT DO NOTHING`
- `migrate-legacy.ts` deduplicates by `(amount, transaction_at, note)` — re-running inserts 0 new transactions
