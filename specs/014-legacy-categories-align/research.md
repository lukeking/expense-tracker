# Research: Legacy Category Curation & Migration

**Feature**: 014-legacy-categories-align  
**Date**: 2026-05-20

---

## §1 — Current Dry-Run Category Output

**Decision**: The existing dry-run (`writeDryRunFile`) outputs per-major counts only (e.g., `食  3420`). It does **not** emit per-subcategory frequencies.

**Rationale**: FR-001 is genuinely new functionality requiring a code change to `writeDryRunFile`.

**Alternatives considered**: None — the gap is factual.

---

## §2 — Source of Subcategories in the Parser

**Decision**: Subcategories cannot be fully enumerated from static code analysis alone. They come from two sources:

1. **CSV item field** — split on `)`: text before `)` → subcategory; text after → description. `normalizeSubcategory` then applies `SUBCATEGORY_REMAP`.
2. **`TAG_CORRECTIONS`** — post-hoc override that can replace the entire `major:subcategory` tag.

The long tail (e.g., `食:紅茶拿鐵`, `食:雞腿便當`) comes from freeform CSV item fields and cannot be predicted from config analysis. A dry-run against the actual CSV is the only authoritative enumeration.

**Rationale**: Static analysis of `TAG_CORRECTIONS` and `SUBCATEGORY_REMAP` enumerates the *known corrected* subcategories (~30–40 entries), but the CSV likely produces 100+ distinct subcategories. The dry-run is the correct tool.

---

## §3 — Known Mismatches Between Migration 011 Seed and Parser Output

The following subcategory names in the migration 011 seed conflict with what the parser actually produces:

| Seed (migration 011) | Parser produces | Cause |
|---|---|---|
| `行:計程車` | `行:搭計程車` | `SUBCATEGORY_REMAP: 計程車 → 搭計程車` |
| `行:油費` | `行:加油費` | `SUBCATEGORY_REMAP: 加油 → 加油費` |
| `住:租金` | `住:房租` | `SUBCATEGORY_REMAP: 房租費 → 房租` |

**Decision**: These are curation decisions, not bugs. Options per row:
- Keep the seed name and add a `SUBCATEGORY_REMAP` entry to map parser output → seed name
- Keep the parser name and update the SQL migration seed to use the parser name

**Recommendation**: Align on the parser name (it reflects the user's original data vocabulary) and update the SQL migration to use it. The migration 011 seed names (`計程車`, `油費`, `租金`) were chosen before this curation pass.

---

## §4 — Missing Major Categories in Seed

The following major categories are produced by the parser but have no `(major, NULL)` row in migration 011:

| Major | Source |
|---|---|
| `其他` | `CATEGORY_MAP: 他 → 其他`; also `TAG_CORRECTIONS` outputs |
| `衣` | `CATEGORY_MAP: 衣 → 衣` |

Both need `(major, NULL)` rows in `012_legacy_categories.sql` before subcategory rows for those majors.

---

## §5 — Known Subcategories from Static Analysis

Subcategories guaranteed to appear (from `TAG_CORRECTIONS` and `SUBCATEGORY_REMAP`):

**其他** (entirely new major):
`App`, `國外交易服務費`, `電信費`, `手續費`, `3C周邊`, `文具`, `保險`

**衣** (entirely new major):
`衣物` (from `衣服`), `理髮` (from `剪髮`)

**食** (additions to existing major):
`咖啡` (from `美式`), `Uber Eats`, `Uber Eats Pass`, `Uber Eats Tips`, `補給` (CSV-derived)

**行** (additions/corrections):
`Uber`, `U-Bike`, `搭計程車` (conflicts with seed `計程車`), `加油費` (conflicts with seed `油費`)

**醫** (additions):
`保險`, `iHerb`

**樂** (additions):
`Netflix`, `Youtube Premium`, `FFXIV`, `Steam`, `電影` (from `看電影`)

**住** (corrections):
`房租` (conflicts with seed `租金`)

**Full enumeration of long-tail subcategories** requires dry-run output after FR-001 is implemented.

---

## §6 — Auto-Upsert Approach

**Decision**: Use Supabase's `upsert` with `ignoreDuplicates: true` (maps to `ON CONFLICT DO NOTHING`).

**Rationale**: The `categories` table has `UNIQUE NULLS NOT DISTINCT (major, subcategory)`. The upsert with ignore semantics is safe, idempotent, and requires no pre-check query.

**Alternative considered**: Query first, then insert only missing rows — rejected as two round-trips with no benefit given idempotent upsert is available.

---

## §7 — Sort Order Strategy

**Decision**: New categories appended after the highest existing `sort_order` for the same major, using multiples of 10 in descending frequency order from the final dry-run.

**Rationale**: Consistent with migration 011 pattern (multiples of 10). Frequency ordering surfaces the most-used subcategories first in the picker.

**Implementation**: At SQL authoring time, take the final dry-run subcategory list sorted by count descending, then assign `sort_order` values starting at `(max existing sort_order for that major) + 10`, incrementing by 10.
