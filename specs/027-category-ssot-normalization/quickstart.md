# Quickstart: Category SSOT Normalization

## 1. Dev environment

```bash
cd backend && pnpm dev          # Worker on :8787 (wrangler, uses .dev.vars)
cd pwa && pnpm dev --port 5300  # 5173-5243 may be Hyper-V-reserved on this machine
```

Backend checks (all must stay green; pre-commit runs them):

```bash
cd backend && pnpm run typecheck && pnpm run lint && pnpm run test
cd pwa && pnpm run typecheck
```

## 2. Manual verification walkthroughs

### US1 — live inheritance (P1)

1. Create a tx (Entry): category `食:雜貨`, 2 items without per-item categories, save.
2. Inspect (network tab or edit sheet): items carry **no** `:`-tag.
3. Edit the tx → change category to `日用:雜貨` → save → reopen: both items now show `日用:雜貨` (inherited); Summary moved the full amount; grand total unchanged.

### US2 — overrides & explicit-其他 (P2)

1. On the same tx, set item A to `樂:遊戲` (override), set item B via 設為「其他」, leave item C inheriting.
2. Change the tx category again → only C moves; A stays `樂:遊戲`; B stays under 其他 (no ⚠ flag — it shows a normal 其他 chip).
3. Item A → 繼承主分類 → A resumes following the tx.
4. Assign item C the tx's own category → saved as inherit (reopen: no stored tag; still follows).
5. Repeat assign/clear from **all four surfaces**: Entry, Edit, import review, Summary list.

### US3 — migration (P3)

```bash
cd backend
pnpm exec tsx scripts/normalize-category-ssot.ts            # dry-run: report only
pnpm exec tsx scripts/normalize-category-ssot.ts --apply    # after reviewing the report
```

Dry-run report must show: per-period per-category totals **identical** before/after; promoted-tx count; collapsed-item count; skipped (guard) txs listed. After `--apply`: spot-check a legacy unanimous-items tx (now shows a tx-level category; items inherit) and a mixed-category legacy tx (unchanged). Script is idempotent — a second dry-run reports zero pending changes.

## 3. Rollout order (D7)

1. Merge → CI auto-deploys Worker + Pages.
2. Dry-run the script against live DB; review.
3. `--apply`; keep the verification output.

## 4. FR-014 picker mockup — ⚠ REQUIRES SIGN-OFF BEFORE IMPLEMENTING

Replaces the single `✕ 繼承主分類（…）/清除分類` row in `ItemCategorySheet`.

**Rendered mockup** (pixel-accurate; built from the component's exact Tailwind values):
![`mockups/fr-014-picker.png`](mockups/fr-014-picker.png) · source [`mockups/fr-014-picker.html`](mockups/fr-014-picker.html)

Four states — **A** inherit active (tx = `食:雜貨`), **B** 設為「其他」 active (sentinel stored), **C** tx without category (inherit row reads `不分類（跟隨主分類）`, same `null` semantics), **D** dark mode.

- Inherit row → `onSelect(null)`; highlighted when the item has no stored `:`-tag.
- 設為「其他」 row → `onSelect('其他:未分類')`; highlighted when the item tag equals the sentinel.
- Sentinel never appears in search results, major/sub chips, or `extraTags`.
- Everything below the two action rows is unchanged from 026.

## 5. Where the moving parts live

| Concern | File |
|---|---|
| Sentinel + merge/normalize rules (backend) | `backend/src/services/item-category.ts` |
| Sentinel + effective-category (PWA) | `pwa/src/lib/itemCategory.ts` |
| Write paths | `backend/src/handlers/pwa.ts` (POST/PUT/PATCH/refund-link), `discord.ts`, `android.ts`, `services/expense-parser.ts` |
| Aggregation (unchanged — regression-tested) | `backend/src/services/summary.ts` |
| Migration script | `backend/scripts/normalize-category-ssot.ts` |
| Picker | `pwa/src/components/ItemCategorySheet.tsx` |
