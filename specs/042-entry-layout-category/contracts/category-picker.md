# Contract: CategoryPicker (major top-N + 更多, frequency ordering)

**Feature**: 042-entry-layout-category | **Date**: 2026-06-29

UI contract for the reworked `pwa/src/components/CategoryPicker.tsx`. Props are **unchanged** — only internal rendering/ordering changes, so every consumer (expense entry, fee entry, edit surfaces) benefits without changes.

## Props (unchanged)

```ts
interface Props {
  value: CategorySelection | null;          // { major, subcategory|null }
  onChange: (value: CategorySelection | null) => void;
}
```

## Behavior

### Major row
- Renders a **frequency-ranked top-N** of majors inline (N = single constant, tuned to fit one row at 390px, ≈3–4) followed by a 「⋯ 更多」 chip. **No horizontal scroll** (drop `overflow-x-auto`).
- Order comes from `useCategoryUsage().majorRank`; when `hasData` is false, fall back to `useMajors(categories)` order.
- The currently-selected major MUST always be visible even if outside top-N (surface it in the inline set).
- Each chip renders `MAJOR_ICONS[major] ? "{icon} {major}" : major` (existing icon map; graceful fallback).
- Tapping a major selects it (same toggle semantics as today: tapping the selected major clears selection).

### 更多 overflow
- Tapping 「⋯ 更多」 opens the existing `BottomSheet` titled e.g. `t('category.allMajorsTitle')`.
- Sheet lists **all** majors (frequency order, full set) with icons; selecting one sets the major and closes the sheet.

### Sub-category row
- Visible sub-chips ordered by `useCategoryUsage().subRank.get(major)`; fall back to `useSubcategories` order when no data.
- Existing `MAX_VISIBLE_SUBCATEGORIES` + sub-overflow `BottomSheet` (with search) retained; the overflow list also uses frequency order.

## Acceptance (maps to spec)
- FR-009 / SC-002: major options reachable with zero horizontal scroll (top-N + 更多).
- FR-010: inline majors are most-used first.
- FR-011: 更多 reveals all majors w/ icons; selection closes sheet.
- FR-012: sub-categories most-used first.
- FR-014: empty history → stable default order, no error.
- FR-015: applies everywhere CategoryPicker is used (props unchanged).

## Non-functional
- Ranking from a memoized, once-per-session computation (`useCategoryUsage`); no per-render recompute; no reshuffle on mid-session entry add.
- New visible strings (`category.allMajorsTitle`, 「更多」) in zh + en.
