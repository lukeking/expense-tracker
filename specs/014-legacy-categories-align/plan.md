# Implementation Plan: Legacy Category Curation & Migration

**Branch**: `014-legacy-categories-align` | **Date**: 2026-05-20 | **Spec**: [spec.md](spec.md)  
**Input**: Feature specification from `specs/014-legacy-categories-align/spec.md`

---

## Summary

Extend `migrate-legacy.ts` dry-run output to emit a per-subcategory frequency table, enabling the user to review and iteratively curate the category taxonomy before running the data migration. Once curation is complete, a new SQL migration (`012_legacy_categories.sql`) extends the `categories` table with every curated `(major, subcategory)` pair. The script is also updated to auto-upsert any categories it encounters on future runs.

---

## Technical Context

**Language/Version**: TypeScript (tsx), Node.js  
**Primary Dependencies**: `@supabase/supabase-js`, `dotenv`, `tsx` (script runner)  
**Storage**: Supabase (PostgreSQL) — `categories` table, `transactions` table  
**Testing**: Manual — dry-run output serves as the verification artefact  
**Target Platform**: Local developer machine  
**Project Type**: CLI / one-time migration script  
**Performance Goals**: N/A (offline, one-time operation)  
**Constraints**: SQL migration must be idempotent; dry-run must produce zero DB writes  
**Scale/Scope**: ~17,000 CSV rows; ~50–100 curated categories expected in final taxonomy

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First** — No new components. Changes are confined to one script file and one new SQL file. No abstractions introduced beyond what the task requires.
- [x] **II. Offline-First on Android** — N/A. This is a local CLI migration tool, not Android.
- [x] **III. Serverless Boundary Compliance** — N/A. This is not a CF Worker operation.
- [x] **IV. Automation Over Manual Input** — The dry-run automates full category enumeration. Curation decisions are intentionally manual (one-time data quality judgment, not ongoing input).
- [x] **V. Security at System Boundaries** — `SUPABASE_SERVICE_ROLE_KEY` read from `backend/.env`; never hardcoded or committed.

---

## Project Structure

### Documentation (this feature)

```text
specs/014-legacy-categories-align/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
└── tasks.md             ← Phase 2 output (not yet created)
```

### Source Code

```text
backend/
├── scripts/
│   └── migrate-legacy.ts          ← UPDATE: add subcategory freq table to dry-run;
│                                      add categories upsert before batch insert
├── src/services/
│   ├── legacy-csv-config.ts       ← UPDATE during curation: SUBCATEGORY_REMAP,
│   │                                  TAG_CORRECTIONS, BEIZHU_RULES
│   └── legacy-csv-parser.ts       ← read-only (no changes expected)
└── supabase/migrations/
    └── 012_legacy_categories.sql  ← NEW: extends categories table with curated taxonomy
```

**Structure Decision**: Single backend project. All changes are in the existing `backend/` tree. No new projects, packages, or services.

---

## Complexity Tracking

> No constitution violations — table left empty.

---

## Implementation Phases

### Phase 0: Research

*See [research.md](research.md) for full findings.*

Key questions resolved before coding:

1. **What does the dry-run currently output for categories?** — Only per-major totals (e.g., `食 3420`). No per-subcategory breakdown. FR-001 is genuinely new functionality.

2. **Where do subcategories come from in the parser?** — Two sources:
   - The CSV item field split on `)`: text before `)` becomes the subcategory, after becomes the description. Then `SUBCATEGORY_REMAP` is applied.
   - `TAG_CORRECTIONS` can completely replace the resulting `major:subcategory` tag with a different one.
   - Therefore: static analysis of config files can enumerate *known* corrected subcategories (from `TAG_CORRECTIONS` and `SUBCATEGORY_REMAP`), but the full long tail comes from the CSV data itself. **A dry-run against the real CSV is the only authoritative enumeration.**

3. **What mismatches exist between migration 011 seed and parser output?** — See research.md §3. Notable conflicts: `行:計程車` (in DB) vs `行:搭計程車` (SUBCATEGORY_REMAP output); `行:油費` (in DB) vs `行:加油費` (SUBCATEGORY_REMAP); `住:租金` (in DB) vs `住:房租` (SUBCATEGORY_REMAP from `房租費`). These are curation decisions, not bugs — the user decides which name wins.

4. **What majors are missing from the categories table entirely?** — `其他` and `衣`. Both need `(major, NULL)` rows added before any subcategory rows.

---

### Phase 1: Design

#### 1. Dry-Run Subcategory Frequency Table (FR-001, FR-002)

**Change**: `backend/scripts/migrate-legacy.ts` — `writeDryRunFile` function.

After the existing "Category coverage" block (which shows per-major counts), add a new section:

```
Subcategory breakdown (major:subcategory — count):
  食:早餐              1420
  食:午餐               890
  食:飲料               654
  其他:國外交易服務費    312
  ...
  (sorted descending by count)
```

**Logic**: iterate `rows` (already parsed `ParsedLegacyRow[]`), extract the first tag matching the pattern `/^[^:]+:[^:]+$/` (i.e. `major:subcategory` format — has exactly one `:`), accumulate counts in a `Map<string, number>`, sort descending, write to the dry-run report file.

Plain tags (no `:`) are excluded by the regex filter — FR-002 satisfied.

#### 2. Curation Workflow (User-Driven, No Code)

After step 1 is implemented, the workflow is:

```
loop:
  npx tsx scripts/migrate-legacy.ts --dry-run NaggingMoney_*.csv
  → review dry-run-*.txt subcategory breakdown
  → update legacy-csv-config.ts (SUBCATEGORY_REMAP / TAG_CORRECTIONS / BEIZHU_RULES)
until taxonomy is clean
```

The curation loop produces a refined `legacy-csv-config.ts`. This is the most time-consuming part of the feature — purely iterative user work.

#### 3. SQL Migration (`012_legacy_categories.sql`) (FR-003, FR-004, FR-005)

Once curation is complete, the final dry-run output is the authoritative source for the SQL. The migration is authored manually (or with a helper one-liner) from the final subcategory list:

```sql
INSERT INTO categories (major, subcategory, sort_order) VALUES
  ('其他', NULL,   0),          -- major-level row (missing from 011 seed)
  ('衣',   NULL,   0),          -- major-level row (missing from 011 seed)
  ('其他', '電信費',  10),
  ('其他', '手續費',  20),
  ...
ON CONFLICT DO NOTHING;
```

**Sort order**: append after highest existing `sort_order` for each major, in descending frequency order from the final dry-run (most-used subcategory = lowest sort number within the appended block). The `ON CONFLICT DO NOTHING` guarantees idempotency.

**Execution order**: `012_legacy_categories.sql` → `migrate-legacy.ts` (live run).

#### 4. Script Auto-Upsert (FR-006, FR-007)

**Change**: `backend/scripts/migrate-legacy.ts` — `main` function, before the batch loop.

```typescript
// Collect unique major:subcategory tags from all parsed rows
const categoryPairs = new Set<string>();
for (const row of rows) {
  for (const tag of row.tags) {
    if (/^[^:]+:[^:]+$/.test(tag)) categoryPairs.add(tag);
  }
}

// Upsert into categories table (ON CONFLICT DO NOTHING)
const categoryRows = [...categoryPairs].map((tag) => {
  const [major, subcategory] = tag.split(':');
  return { major, subcategory, sort_order: 9999 };  // high sort = appended
});
if (categoryRows.length > 0) {
  await supabase.from('categories').upsert(categoryRows, { onConflict: 'major,subcategory', ignoreDuplicates: true });
}
```

In `--dry-run` mode, collect the same set but write to the report as "would create categories: N new" with the list — no DB write.

---

## Execution Order

```
1. Implement dry-run subcategory table (code change)
2. Run dry-run → review subcategory list
3. Iterate: update config → re-run dry-run → repeat until taxonomy is clean
4. Apply supabase/migrations/012_legacy_categories.sql  (npx supabase db push or direct SQL)
5. Run migrate-legacy.ts live against the CSV
6. Verify: query DB for any legacy transaction tags with no matching categories row → expect 0
```

---

## Known Curation Decision Points

These mismatches between the migration 011 seed and parser output should be resolved during curation (listed so they are not forgotten):

| Seed (migration 011) | Parser output | Decision needed |
|---|---|---|
| `行:計程車` | `行:搭計程車` (SUBCATEGORY_REMAP) | Keep one name; update seed or remap |
| `行:油費` | `行:加油費` (SUBCATEGORY_REMAP) | Keep one name |
| `住:租金` | `住:房租` (SUBCATEGORY_REMAP from `房租費`) | Keep one name |
| `樂:娛樂` | Varies — catch-all or specific? | Decide scope |
| `樂:旅遊` | Travel expenses — broad | Confirm stays as-is |
