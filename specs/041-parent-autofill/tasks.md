# Tasks: 連結原始交易 auto-fill (parent-transaction auto-fill for fee/refund)

**Input**: Design documents from `/specs/041-parent-autofill/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Backend handler/logic tests are REQUIRED by the project constitution (Vitest worker tests for handlers; pure-helper unit tests). The PWA has no unit harness — its coverage is `tsc -b` + the i18n parity guard, plus an optional Playwright E2E smoke.

**Organization**: Tasks are grouped by user story. ⚠️ **Shared-file constraint**: all four user stories edit the **same file** `pwa/src/screens/EntryScreen.tsx` (the `FeeForm` / `RefundForm` components). Those tasks are therefore **sequential** (never `[P]` with each other). Only the backend files, the shared type, the i18n files, the extracted lib, and the test files parallelize.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different file, no dependency on an incomplete task)
- **[Story]**: US1–US4 (maps to spec.md user stories)

## Path Conventions

Web app: backend = `backend/src/`, `backend/tests/`; PWA = `pwa/src/`; E2E = `e2e/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization.

- None required — feature lands in the existing PWA + CF Worker. Proceed to Foundational.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Surface the parent's `payment_method` + resolved `category` through `GET /pwa/parent-search`, and widen the shared result type. **Blocks US1 and US2** (they consume these fields). US3/US4 use already-returned fields and do not depend on this phase (but share `EntryScreen.tsx`).

**⚠️ CRITICAL**: Complete before starting US1 / US2.

- [ ] T001 [P] Backend — in `backend/src/db/queries.ts`: add an exported pure helper `resolveSingleCategory(txTags: string[], itemTagsLists: string[][]): string | null` that returns the single distinct `主:子` tag across all tags (`t.includes(':')`), or `null` when zero/▶multiple distinct (mirror the colon-tag detection in `enrichRefundTags`; see contracts/parent-search.md).
- [ ] T002 Backend — in `backend/src/db/queries.ts`: extend `findParentCandidates` to (a) add `payment_method` to the `.select(...)`, (b) request item `tags` already present, and (c) return each candidate enriched with `payment_method` and `category` (computed via `resolveSingleCategory`); widen the function's return type accordingly. (depends on T001; same file as T001)
- [ ] T003 Backend — in `backend/src/handlers/pwa.ts` (`GET /pwa/parent-search`, ~L686): include `payment_method` and `category` on each object in the `transactions` response mapping. (depends on T002)
- [ ] T004 [P] Frontend — in `pwa/src/components/ParentSearch.tsx`: extend `ParentSearchResult` with `payment_method: string` and `category: string | null`. (different file)
- [ ] T005 [P] Backend test — in `backend/tests/db/queries.test.ts`: unit-test `resolveSingleCategory` (single category → that tag; tx-level tag + inherited item tags → that one tag; multiple distinct → `null`; no colon-tag → `null`).
- [ ] T006 Backend test — in `backend/tests/db/queries.test.ts`: extend the `findParentCandidates` coverage to assert each returned candidate carries `payment_method` and the resolved `category` (single-category fixture → the tag; multi-category fixture → `null`). (depends on T002; same file as T005)

**Checkpoint**: `parent-search` returns `payment_method` + `category`; `ParentSearchResult` carries them; backend tests green.

---

## Phase 3: User Story 1 - Payment method flows from the linked original (Priority: P1) 🎯 MVP

**Goal**: Linking an original sets the payment method on both tabs, non-destructively.

**Independent Test**: On 手續費 and 退款, enter an amount, link an original paid by a non-default method → the payment pill switches to it; manually change it, re-link a different original → manual choice survives; submit succeeds.

- [ ] T007 [US1] In `pwa/src/screens/EntryScreen.tsx` `FeeForm`: add a `paymentTouched` flag set when the user changes `PaymentPills`; on `ParentSearch` select, set `paymentMethod = parent.payment_method` only when `!paymentTouched`; clear the flag in the success/reset handler. (EntryScreen.tsx)
- [ ] T008 [US1] In `pwa/src/screens/EntryScreen.tsx` `RefundForm`: same `paymentTouched` flag + auto-fill of the "退款至" payment method from `parent.payment_method` on select; clear on reset. (EntryScreen.tsx; after T007 — same file)

**Checkpoint**: Payment-method auto-fill works on both tabs and never overrides a manual pick. MVP deliverable.

---

## Phase 4: User Story 2 - Category flows from the linked original on a fee (Priority: P2)

**Goal**: On 手續費, a single-category original pre-fills the fee category; ambiguous/uncategorized leaves it for the user; manual choice survives.

**Independent Test**: On 手續費, link a single-category original → 分類 pre-fills; link a multi-category/uncategorized original → 分類 stays empty; pick a category by hand then link → manual category kept.

- [ ] T009 [P] [US2] Extract `parseCategorySelection(tag): CategorySelection | null` into `pwa/src/lib/categoryTag.ts` and update `pwa/src/components/EditFeeRefundSheet.tsx` + `pwa/src/components/EditExpenseSheet.tsx` to import it (de-duplicate the two existing copies). (does not touch EntryScreen.tsx — parallelizable with US1)
- [ ] T010 [US2] In `pwa/src/screens/EntryScreen.tsx` `FeeForm`: add a `categoryTouched` flag set when the user changes `CategoryPicker`; on select, when `!categoryTouched && parent.category != null` → `setCategory(parseCategorySelection(parent.category))`; clear the flag on reset. Import `parseCategorySelection` from `lib/categoryTag.ts`. (EntryScreen.tsx; after T009 and after US1 EntryScreen tasks — same file)

**Checkpoint**: Fee category auto-fills only on an unambiguous original; refund tab unaffected (no category field).

---

## Phase 5: User Story 3 - One-tap full refund amount (Priority: P2)

**Goal**: On 退款, a 「全額退款」 button appears once an original is linked and one-taps the amount to the original's full amount (still editable).

**Independent Test**: On 退款 with no link → no button; link an original → button appears; tap → 金額 = parent total; edit 金額 down → edit kept.

- [ ] T011 [P] [US3] Add `entry.fullRefund` to `pwa/src/i18n/zh.ts` (`'全額退款'`) and `pwa/src/i18n/en.ts` (`'Full refund'`). (i18n files — parallelizable; parity enforced by tsc/i18n:check)
- [ ] T012 [US3] In `pwa/src/screens/EntryScreen.tsx` `RefundForm`: render a 全額退款 button (using `t('entry.fullRefund')`) only when `parent != null`, near the amount field; `onClick` → `setAmount(String(parent.amount))`; amount stays editable. (EntryScreen.tsx; after prior EntryScreen tasks — same file; needs T011)

**Checkpoint**: Full-refund one-tap works and is hidden until a parent is linked.

---

## Phase 6: User Story 4 - Description flows from the linked original on a refund (Priority: P3)

**Goal**: On 退款, linking fills the description from the original's label when empty (parity with the fee tab).

**Independent Test**: On 退款 with empty 說明 → linking fills it from the parent label; with 說明 typed → linking preserves it.

- [ ] T013 [US4] In `pwa/src/screens/EntryScreen.tsx` `RefundForm`: on `ParentSearch` select, when `description` is empty set it from the parent label (`parent.note ?? parent.item_names[0] ?? parent.tags[0] ?? ''`), mirroring `FeeForm`'s existing `onSelect`. (EntryScreen.tsx; after prior EntryScreen tasks — same file)

**Checkpoint**: All four stories functional; both tabs behave consistently.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T014 [P] Run `cd backend && pnpm test` — confirm `resolveSingleCategory` + `findParentCandidates` (payment_method/category) pass.
- [ ] T015 [P] Run `cd pwa && pnpm exec tsc -b && pnpm i18n:check` — types for new `ParentSearchResult` fields/form wiring + `entry.fullRefund` zh=en parity.
- [ ] T016 [P] (Optional) Add a Playwright smoke in `e2e/tests/` — link a parent (assert payment pill + fee category pre-fill), tap 全額退款 (assert amount = parent total), and assert a manually-changed field survives a re-link.
- [ ] T017 Manual verification against `specs/041-parent-autofill/quickstart.md` (the 10 verification steps).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: blocks **US1** and **US2** (they read `payment_method` / `category`). US3 and US4 are logically independent of it (existing fields) but share `EntryScreen.tsx`.
- **User Stories (Phase 3–6)**: US1 → US2 → US3 → US4 run in this order **because they all edit `pwa/src/screens/EntryScreen.tsx`** and must serialize. (Their *logic* is independent and each is independently testable; only the file forces order.)
- **Polish (Phase 7)**: after the desired stories.

### Within Foundational

- T001 → T002 → T003 (queries helper → query enrichment → handler mapping).
- T004 (type) parallel with T001–T003 (different file).
- T005 parallel; T006 after T002 (same test file as T005, so T005 then T006).

### Parallel opportunities

- **T001 / T004 / T005** can start together (different files).
- **T009** (lib extraction) and **T011** (i18n) are different files and can run anytime — parallel with backend and with US1's EntryScreen work.
- ❌ **Not parallel**: T007, T008, T010, T012, T013 — all mutate `EntryScreen.tsx`. Do them one at a time in story order.

---

## Parallel Example: Foundational kickoff

```bash
# Different files, no inter-dependency — safe to do together:
T001  backend/src/db/queries.ts      (resolveSingleCategory helper)
T004  pwa/src/components/ParentSearch.tsx  (extend ParentSearchResult)
T005  backend/tests/db/queries.test.ts     (resolveSingleCategory unit tests)
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 2 Foundational (T001–T006) → backend returns payment_method + category, type + tests ready.
2. Phase 3 US1 (T007–T008) → payment-method auto-fill on both tabs.
3. **STOP and validate** with quickstart steps 1–2 (+ submit). Ship if desired.

### Incremental delivery

US1 (payment) → US2 (fee category) → US3 (全額退款) → US4 (refund description). Each adds value without breaking the previous; each is verifiable via its Independent Test. Because all four touch `EntryScreen.tsx`, deliver them sequentially.

### Notes

- `[P]` = different file, no incomplete dependency.
- Auto-fill is non-destructive (touched-flag gated) and create-time only — see contracts/autofill-ui.md.
- Commit after each task or logical group.
- No DB migration; no new endpoint or dependency.
