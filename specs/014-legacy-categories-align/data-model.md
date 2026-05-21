# Data Model: Legacy Category Curation & Migration

**Feature**: 014-legacy-categories-align  
**Date**: 2026-05-20

---

## Existing Tables (no schema changes)

### `categories`

Already defined by migration 011. No column changes — this feature only adds rows.

```sql
CREATE TABLE categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  major        TEXT NOT NULL,
  subcategory  TEXT,                          -- NULL = major-level entry
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_category UNIQUE NULLS NOT DISTINCT (major, subcategory)
);
```

**Rows added by this feature**: All `(major, subcategory)` pairs produced by the curated parser config that do not already exist in the 011 seed. Includes `(major, NULL)` rows for `其他` and `衣`.

### `transactions` / `transaction_items`

No changes. The migration inserts rows here (unchanged from feature 010 plan), now running against a fully populated categories table.

---

## New Artefact: `012_legacy_categories.sql`

Not a schema change — a data seed. Structure:

```sql
-- Major-level rows for missing majors (must come first)
INSERT INTO categories (major, subcategory, sort_order) VALUES
  ('其他', NULL, 0),
  ('衣',   NULL, 0)
ON CONFLICT DO NOTHING;

-- Subcategory rows (grouped by major, ordered by descending frequency)
INSERT INTO categories (major, subcategory, sort_order) VALUES
  -- 其他
  ('其他', '國外交易服務費', 10),
  ('其他', '電信費',         20),
  ('其他', '手續費',         30),
  ...
  -- 衣
  ('衣', '衣物',  10),
  ('衣', '理髮',  20),
  ...
  -- 食 (additions only — 早餐/午餐/etc. already in 011 seed)
  ('食', '咖啡',       70),   -- after sort_order=60 (飲料) in 011
  ('食', '補給',       80),
  ...
  -- 行 (may supersede seed entries — see curation decisions)
  ...
  -- 醫 (additions)
  ('醫', '保險',  30),
  ('醫', 'iHerb', 40),
  ...
  -- 樂 (additions)
  ('樂', 'Netflix',        30),
  ('樂', 'Youtube Premium', 40),
  ('樂', 'FFXIV',          50),
  ('樂', 'Steam',          60),
  ('樂', '電影',           70),
  ...
ON CONFLICT DO NOTHING;
```

**Note**: Exact values and sort orders are finalized during the curation phase (Step 3 in quickstart). The SQL above is a structural template, not the final file.

---

## Parser Config Artefacts (updated during curation)

### `SUBCATEGORY_REMAP` (in `legacy-csv-config.ts`)

Maps raw subcategory strings from the CSV item field to canonical subcategory names.

```typescript
export const SUBCATEGORY_REMAP: Record<string, string> = {
  // existing entries...
  // potential additions / changes during curation:
  // '計程車': '搭計程車',   ← already present, may be renamed
  // '加油':   '加油費',     ← already present, may be renamed
  // '房租費': '房租',       ← already present, may be renamed
};
```

### `TAG_CORRECTIONS` (in `legacy-csv-config.ts`)

Overrides the final `major:subcategory` tag for specific source tag values. No structural changes — entries may be added or modified during curation.

### `BEIZHU_RULES` (in `legacy-csv-config.ts`)

Maps 備註 field values to tag/note overrides. Entries with `tag: 'X:Y'` format affect the category taxonomy. Some entries may be updated or removed during curation (~1,000 lines; curation may touch a significant subset).

---

## Validation Rules

- Every `(major, subcategory)` tag on a `source='legacy_migration'` transaction MUST have a corresponding row in `categories` after both migrations run.
- `(major, NULL)` rows MUST exist for every major that has subcategory rows.
- SQL migration MUST use `ON CONFLICT DO NOTHING` — re-running must produce zero errors and zero new rows.
