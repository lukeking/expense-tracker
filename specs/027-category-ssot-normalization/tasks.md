# Tasks: Category Single Source of Truth (B2 Normalization)

**Input**: Design documents from `/specs/027-category-ssot-normalization/`
**Prerequisites**: plan.md, spec.md, research.md (D1–D7), data-model.md, contracts/internal-api.md, quickstart.md (FR-014 mockup **approved 2026-06-10**)

**Tests**: Included — the constitution's Quality Standards require Vitest coverage for all Worker handlers, and FR-008/FR-010 demand explicit equivalence evidence.

**Organization**: Grouped by user story. US1 (live inheritance) is the MVP; US2 (overrides + explicit-其他) and US3 (migration) build on the shared foundation but are independently testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 per spec.md

---

## Phase 1: Setup

*No setup tasks — existing two-project workspace; no new dependencies, no schema changes.*

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The sentinel constant and the shared normalization/derivation helpers every story consumes.

- [x] T001 `backend/src/services/item-category.ts`: add `EXPLICIT_UNCATEGORIZED = '其他:未分類'` and pure `normalizeItemTagsOnWrite(txCategoryTag: string | null, itemTags: string[]): string[]` — preserves plain tags and the sentinel; drops a `:`-tag equal to `txCategoryTag` (FR-013 collapse); keeps a differing `:`-tag (override); guarantees ≤1 `:`-tag out (invariants I1–I3, data-model.md). `mergeItemCategoryTag` behavior unchanged.
- [x] T002 [P] Create `backend/tests/services/item-category.test.ts`: `normalizeItemTagsOnWrite` — collapse-equal, keep-different, sentinel pass-through, plain tags untouched, empty inputs; sentinel constant is **not** present in `backend/supabase/seed/categories.md` (guards D1's "never in catalog").
- [x] T003 [P] `pwa/src/lib/itemCategory.ts`: add `EXPLICIT_UNCATEGORIZED`; add `effectiveItemCategory(item, tx): { tag: string | null; source: 'override' | 'explicit-uncategorized' | 'inherited' | 'none' }` per data-model.md derivation; update `isItemUncategorized` so the sentinel counts as categorized (invariant I4 — no ⚠ flag for a deliberate 其他).

**Checkpoint**: Foundation ready — backend suite green, both libs typecheck.

---

## Phase 3: User Story 1 — Re-categorize once, everything inherits (Priority: P1) 🎯 MVP

**Goal**: Write paths stop copying the tx category onto inheriting items; PWA surfaces display the *effective* (live-inherited) category. Aggregation already implements live inheritance (research.md D4) — regression tests pin that down.

**Independent Test**: quickstart.md §2 US1 — create a categorized tx with untagged items, change the tx category once: items and Summary follow, grand total unchanged, stored items carry no category copy.

### Backend — write paths (`backend/src/handlers/pwa.ts` tasks are same-file → sequential)

- [x] T004 [US1] `backend/src/handlers/pwa.ts` POST `/pwa/transactions` (~L190): item tags become `normalizeItemTagsOnWrite(category_tag, item.tag != null ? [item.tag] : [])` — no more `category_tag` copy onto inheriting items; `items[].tag === category_tag` collapses to `[]`. Depends on T001.
- [x] T005 [US1] `backend/src/handlers/pwa.ts` PUT `/pwa/transactions/:id` (~L520): same replacement as T004, including the `afterItems` history snapshot so the edit-history diff reflects the stored (normalized) shape.
- [x] T006 [US1] `backend/src/handlers/pwa.ts` refund-link (~L755-765): keep the parent-category snapshot on the refund **tx** tags; stop copying it onto the refund **item** (`insertTransactionItems` gets `tags: []`) — the item inherits from its own tx.
- [x] T007 [P] [US1] `backend/src/handlers/discord.ts` (~L160-170) + `backend/src/services/expense-parser.ts` `parseItems`: write `sharedCategory` into the **transaction** tags (prepended, B1 convention); items keep only an own `#cat` from the description when it differs (collapse via `normalizeItemTagsOnWrite`); the no-description synthesized item keeps its subcategory-derived name but `tags: []`. Reply-embed rendering unchanged (already displays `sharedCategory` separately).
- [x] T008 [P] [US1] `backend/src/handlers/android.ts` (~L168-184): normalize Gemini-parsed item tags against the tx category; if the tx has no `:`-tag and all items share one, promote it to `tx.tags` (prepended) and collapse the items (data-model.md promotion rule).

### Frontend — effective-category display

- [x] T009 [P] [US1] `pwa/src/components/ItemRow.tsx` + `pwa/src/screens/EntryScreen.tsx`: item category chip renders from `effectiveItemCategory(item, tx)` — explicit override shown as today; inherited value shown de-emphasized (muted/outline, per the approved mockup's visual language); `none` keeps current placeholder. Depends on T003.
- [x] T010 [P] [US1] `pwa/src/screens/SummaryScreen.tsx` (~L59, L70): the transaction-item line shows the effective category via `effectiveItemCategory`; an inherited category renders de-emphasized; sentinel renders as `其他`. Depends on T003.

### Tests (constitution-required)

- [x] T011 [P] [US1] `backend/tests/services/summary.test.ts`: equivalence regressions — (a) the same purchase in old shape (item carries a copy of the tx tag) vs normalized shape (item untagged) produces identical `aggregateByCategory`/`aggregateBySubcategory` results (FR-008); (b) changing the tx tag re-buckets untagged items, grand total unchanged (FR-007/SC-005); (c) mixed-era dataset (one tx of each shape) aggregates correctly (FR-012).
- [x] T012 [P] [US1] Create `backend/tests/handlers/pwa-transactions-category.test.ts`: POST stores no category copy on inheriting items; `items[].tag === category_tag` is collapsed; an overriding `items[].tag` is preserved; PUT same; refund-link item is created with `tags: []` while the refund tx keeps the snapshot tag.
- [x] T013 [P] [US1] `backend/tests/handlers/discord.test.ts` + `backend/tests/handlers/android.test.ts`: update/extend expectations — Discord `/expense` writes `sharedCategory` at tx level and items carry no copies; Android unanimous item category is promoted to tx level.
- [x] T014 [US1] Manual verify per quickstart.md §2 US1 (requires running app + data). Verified 2026-06-11.

**Checkpoint**: US1 shippable — new writes are normalized; displays follow the tx live; suite green.

---

## Phase 4: User Story 2 — Deliberate overrides, explicit and reversible (Priority: P2)

**Goal**: The three-state picker (繼承主分類 / catalog override / 設為「其他」) on all four surfaces, backed by the extended PATCH semantics.

**Independent Test**: quickstart.md §2 US2 — pin one override + one explicit-其他 + one inheriting item on a tx, change the tx category, verify only the inheriting item moves; remove the override and verify it resumes following.

- [x] T015 [US2] `backend/src/handlers/pwa.ts` PATCH `/pwa/transactions/:id/items/:itemId` (~L575-599): per contracts/internal-api.md — incoming `category_tag` equal to the tx's current category is treated as `null` (collapse → inherit); the sentinel passes validation and is stored verbatim; edit-history row only on effective change (026 idempotency preserved). Depends on T001.
- [x] T016 [US2] `backend/tests/handlers/pwa-item-category.test.ts`: extend — assign sentinel (stored verbatim, buckets to 其他); assign tag equal to tx category → item stored with no `:`-tag; inherit (`null`) clears an override and a sentinel alike; idempotent sentinel re-assign writes no history row. Add a drill-down assertion in `backend/tests/services/summary.test.ts`: sentinel item appears under 其他 → subcategory `未分類` (runs after T011 to avoid same-file conflict).
- [x] T017 [US2] `pwa/src/components/ItemCategorySheet.tsx`: implement the **approved mockup** (`mockups/fr-014-picker.png`) — replace the single ✕ row with `↩ 繼承主分類（{inheritedTag}）` → `onSelect(null)` (reads `不分類（跟隨主分類）` when the tx has no category) and `⊘ 設為「其他」（不歸入任何分類）` → `onSelect(EXPLICIT_UNCATEGORIZED)`; highlight inherit when `value === null`, 其他 row when `value === EXPLICIT_UNCATEGORIZED`; exclude the sentinel from search results and `extraTags` chips. Depends on T003.
- [x] T018 [US2] `pwa/src/components/ItemRow.tsx` + `pwa/src/screens/EntryScreen.tsx`: `tagOverride` may hold the sentinel; chip displays it as `其他`; `selectTag` passes `null`/sentinel/tag through unchanged to the POST/PUT payload (`items[].tag`). Depends on T017.
- [x] T019 [P] [US2] `pwa/src/screens/ImportScreen.tsx` (~L275, L436): local-state merge handles `null` (drop `:`-tag) and sentinel (replace `:`-tag) identically to `mergeItemCategoryTag`; ⚠ flag uses the updated `isItemUncategorized` (sentinel = categorized). Depends on T017.
- [x] T020 [P] [US2] `pwa/src/screens/SummaryScreen.tsx`: assign flow passes `null`/sentinel through `assignItemCategory`; sentinel item shows `其他` chip, never the ⚠ flag; react-query invalidations unchanged. Depends on T017.
- [x] T021 [US2] Manual verify per quickstart.md §2 US2 on all four surfaces (Entry, Edit, import review, Summary list). Verified 2026-06-11.

**Checkpoint**: US2 complete — three states selectable, reversible, and correctly bucketed everywhere.

---

## Phase 5: User Story 3 — Existing history normalized invisibly (Priority: P3)

**Goal**: One-off migration with built-in equivalence proof. Run only after US1 (ideally +US2) is deployed, so writes no longer produce the old shape.

**Independent Test**: quickstart.md §2 US3 — dry-run report shows identical per-period totals; spot-checks per acceptance scenarios; second dry-run reports zero pending changes.

- [x] T022 [US3] `backend/src/services/item-category.ts`: add pure `planTransactionNormalization(tx: { tags: string[]; items: { tags: string[] }[] })` returning the proposed tx/item tag changes (or `null` if no-op) — strip-copies when tx categorized; unanimous-promotion when not; sentinel/plain/mixed untouched (data-model.md migration transform, steps 1–2). Depends on T001.
- [x] T023 [P] [US3] `backend/tests/services/item-category.test.ts`: extend — copied-shape strip, unanimous promotion, mixed-category no-op, sentinel untouched, idempotence (planning a normalized tx → `null`); guard scenario: item amounts exceeding `tx.amount` produce a before/after `aggregateByCategory` mismatch that the script must treat as SKIP.
- [x] T024 [US3] Create `backend/scripts/normalize-category-ssot.ts` (pattern: `scripts/migrate-legacy.ts`; env-loaded Supabase creds, never printed): dry-run by default, `--apply` to write; per tx applies `planTransactionNormalization`, verifies bucket equivalence with `aggregateByCategory` (skip + log on mismatch — the total-preserving guard); **no** `transaction_edit_history` rows; final report = per-period per-category totals before/after + promoted/collapsed/skipped counts; idempotent. Depends on T022.
- [ ] T025 [US3] Run against the live DB after US1/US2 are merged & deployed: dry-run → review report → `--apply` → save the verification output as `specs/027-category-ssot-normalization/migration-report.md` (FR-010 evidence). Manual; depends on T024 + deployment.

**Checkpoint**: All historical data normalized; totals provably unchanged; old shape no longer produced anywhere.

---

## Phase 6: Polish & Cross-Cutting

- [x] T026 [P] `pwa/src/components/EditExpenseSheet.tsx`: confirm the dual-source category read (~L97 `deriveCategoryTag(items) ?? tx tag`) and free-tag filtering still behave for all three item states and for guard-skipped legacy data (FR-012); refresh stale comments only — no behavioral change expected.
- [x] T027 Full gates green: `cd backend && pnpm run typecheck && pnpm run lint && pnpm run test` (0 lint errors) and `cd pwa && pnpm run typecheck`; review that SC-001–SC-005 are each evidenced by a test or the migration report.

---

## Dependencies & Execution Order

- **Phase 2 first**: T001 → {T002, T003} ([P] with each other).
- **US1 (Phase 3)**: backend T004 → T005 → T006 (same file, sequential); T007, T008 [P] with each other and with the pwa.ts chain once T001 lands; frontend T009, T010 [P] after T003; tests T011–T013 [P] anytime after their targets; T014 last.
- **US2 (Phase 4)**: T015 after T001 (touches pwa.ts → after T006 to avoid conflicts); T017 after T003; T018–T020 after T017; T016 after T011 (shared summary.test.ts); T021 last.
- **US3 (Phase 5)**: T022 → {T023, T024} → T025 (T025 additionally gated on deploy).
- **US1 ∥ US2 backend overlap**: both touch `backend/src/handlers/pwa.ts` and `item-category.test.ts` — run the phases sequentially as numbered; cross-phase [P] applies only to distinct files.

## Parallel Examples

- After T001: `T002 ∥ T003`.
- US1 wave: `T007 ∥ T008 ∥ T009 ∥ T010 ∥ T011 ∥ T012 ∥ T013` (7 distinct file sets) while T004–T006 proceed sequentially in pwa.ts.
- US2 wave: `T019 ∥ T020` after T017/T018.

## Implementation Strategy

**MVP = Phase 2 + US1** (T001–T014): all new writes normalized, live inheritance visible — shippable alone; old data keeps working via the remainder dedupe (FR-012).
**Increment 2 = US2** (T015–T021): the three-state picker per the approved mockup.
**Increment 3 = US3** (T022–T025): migration after deploy — the only step with a hard external gate.
**Total**: 27 tasks (US1: 11 · US2: 7 · US3: 4 · foundation: 3 · polish: 2).

## Implementation Status (2026-06-11)

Implemented and statically verified: backend typecheck + lint (0 errors) + 365 tests pass; PWA `tsc -b` + `vite build` clean. Both UI mockups (picker FR-014, display states) approved before coding. T014/T021 manual walkthroughs verified 2026-06-11 against the local dev stack (US1 live inheritance; US2 three-state picker incl. override persistence across tx category change, sentinel bucketing under 其他→未分類, picker sentinel exclusion); test transactions removed from the live DB afterward.

Open items:
- **T025** — live `--apply` run, gated on merge + deploy. The **dry-run already executed** against the live DB (read-only): 15,299 txs · 15,211 to update (15,209 promotions — the legacy inverse shape dominates, as designed for) · 3 guard-skipped · 124 periods verified, **zero drift**. Re-run dry-run after deploy, then `--apply`, then save the output as `migration-report.md`.
