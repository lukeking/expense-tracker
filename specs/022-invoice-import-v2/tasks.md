---
description: "Task list for Invoice Import v2 — Interactive Reconciliation"
---

# Tasks: Invoice Import v2 — Interactive Reconciliation

**Input**: Design documents from `/specs/022-invoice-import-v2/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, contracts/schema-ddl.sql

**Tests**: INCLUDED — the project constitution (Quality Standards) mandates Vitest +
`@cloudflare/vitest-pool-workers` unit tests for all CF Workers handlers, and requires
explicit coverage of ambiguous-match and dedup edge cases. SC-003 (no transactions
created) is enforced by a test invariant.

**Organization**: Tasks are grouped by user story (US1 P1, US2 P2, US3 P3) so each can
be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 (omitted for Setup, Foundational, Polish)
- Exact file paths included in each task

## Path Conventions

Web app: backend CF Worker at `backend/`, PWA at `pwa/`. Paths below are repo-relative.

---

## Phase 1: Setup

**Purpose**: Create the schema artifact this feature depends on.

- [X] T001 Create migration `backend/supabase/migrations/020_invoice_match_confidence.sql` from `specs/022-invoice-import-v2/contracts/schema-ddl.sql` (adds `invoices.match_confidence`; adds `import_runs.matched_exact_count`, `matched_near_count`, `skipped_unmatched_count`)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, types, query layer, and old-code removal that ALL user stories depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T002 Apply migration 020 to the Supabase dev database (operational prerequisite for any pipeline write)
- [X] T003 [P] Update `backend/src/types.ts`: add `match_confidence: 'exact' | 'near' | null` to `Invoice`; add `MatchConfidence` and `ItemsOutcome` (`'filled' | 'kept' | 'replaced'`) types; add v2 import-summary + matched-detail + ambiguous-candidate response types; add the three new `import_runs` count fields to `ImportRun`; prune v1-only types no longer produced (`held_forex`/`auto_created`/`parse_failed` usages) where safe
- [X] T004 Remove the Discord CSV-import surface so nothing depends on the old pipeline shape: delete the `import` and `reconcile` command dispatch + `handleImportCommand`, import-summary builder, `handleReconcileCommand`, `handleReconcileLink`, `handleReconcileSkip`, and the `reconcile_link:`/`reconcile_skip:` button dispatch in `backend/src/handlers/discord.ts`; remove the `import` and `reconcile` defs in `backend/scripts/register-commands.ts`; update the `/import` help text in `backend/src/index.ts`; drop import/reconcile cases in `backend/tests/handlers/discord.test.ts`
- [X] T005 Update `backend/src/db/queries.ts` (after T004): widen `findForexCandidateTransaction` → `findForexCandidateTransactions` returning `Transaction[]` (drop `.limit(1)`, ±5% amount band, **±7-day** window, unlinked expense); add `linkInvoiceToTransaction(supabase, invoiceId, txId, confidence)` setting `match_status='matched'` + `match_confidence` + `matched_transaction_id`; remove now-dead `findExactMatchIncludingLinked`, `findAllHeldForexInvoices`, `resolveHeldInvoice`

**Checkpoint**: Schema live, types ready, Discord import gone, query layer is v2-shaped — user stories can begin.

---

## Phase 3: User Story 1 — Upload CSV and Auto-Match Confident Invoices (Priority: P1) 🎯 MVP

**Goal**: Upload a government e-invoice CSV; dedup; auto-link invoices with exactly one exact-amount candidate within ±2 days (classified `exact` same-day / `near` otherwise); classify ≥2-candidate and forex cases as `ambiguous`; count `skipped_unmatched`; never create a transaction.

**Independent Test**: Upload a CSV where every invoice has exactly one same-day candidate; verify all link as `exact`, items filled/kept per rule, transaction count unchanged, and summary counts are correct.

### Tests for User Story 1 ⚠️ (write first, ensure they fail)

- [X] T006 [P] [US1] Rewrite `backend/tests/services/invoice-matcher.test.ts` for v2: dedup → `skipped_duplicate`; 1 exact same-day → `matched`/`exact`; 1 exact at ±2 days → `matched`/`near`; ≥2 exact → `ambiguous`; 0 exact + forex within ±7 days → `ambiguous`; 0 exact + 0 forex → `skipped_unmatched` (no invoice row persisted); items filled when tx has 0 items, kept when items exist; **transaction count identical before/after** (SC-003)
- [X] T007 [P] [US1] Create `backend/tests/handlers/pwa-import.test.ts` with `POST /pwa/import` cases: v2 response shape, the seven count buckets, and `matched[]` detail entries (seller, confidence, items_outcome)

### Implementation for User Story 1

- [X] T008 [US1] Rewrite `runImportPipeline` in `backend/src/services/invoice-matcher.ts` (enrichment-only): dedup → exact match (`findMatchingExpenseTransaction`) auto-link with `exact`/`near` confidence → ≥2 exact ⇒ `ambiguous` → 0 exact ⇒ `findForexCandidateTransactions`; ≥1 ⇒ `ambiguous`, else `skipped_unmatched` (not persisted). Rewrite `populateItemsFromInvoice` to fill only when the tx has zero items (outcome `filled`) else leave unchanged (outcome `kept`), removing the v1 count-match/replace heuristic. Delete `runReconciliationPass`, the forex/unmatched auto-create branches, and the `parseExpenseText`/Gemini import. (depends on T003, T005)
- [X] T009 [US1] Update `POST /pwa/import` in `backend/src/handlers/pwa.ts`: return the v2 summary (`matched_exact`, `matched_near`, `ambiguous`, `skipped_unmatched`, `skipped_duplicate`, `skipped_voided`, `skipped_zero`, `matched[]`) and persist counts to `import_runs` incl. the three new columns. (depends on T008)
- [X] T010 [US1] Update `pwa/src/screens/ImportScreen.tsx`: replace `ImportResult` with the v2 shape; rebuild `RESULT_ROWS` labels (已配對·同日 / 已配對·鄰近 / 模糊待處理 / 略過·未配對 / 略過·重複 / 略過·作廢 / 略過·零額); remove 自動建立 / 待處理外幣 rows. (depends on T009)

**Checkpoint**: A CSV import auto-links confident invoices and shows accurate counts; zero transactions created. MVP deployable.

---

## Phase 4: User Story 2 — Resolve Ambiguous Invoices (Priority: P2)

**Goal**: After import, list each `ambiguous` invoice with its live candidate transactions (exact set, or forex fallback) and let the user pick one and choose keep/replace items; apply the link atomically.

**Independent Test**: Import a CSV with one invoice having two candidates; verify it appears with both candidates; select one with keep-items and confirm; verify the invoice links and items are handled per the chosen option.

### Tests for User Story 2 ⚠️ (write first, ensure they fail)

- [X] T011 [P] [US2] Add `GET /pwa/import/ambiguous` + `POST /pwa/import/resolve` cases to `backend/tests/handlers/pwa-import.test.ts`: ambiguous list returns candidates incl. forex `candidate_source`; resolve with keep vs replace items; confidence (`exact` only if same-day AND exact amount, forex ⇒ `near`); invoice → `matched`; error cases `404 NOT_FOUND`, `409 INVOICE_NOT_AMBIGUOUS`, `409 TRANSACTION_ALREADY_LINKED`
- [X] T012 [P] [US2] Add `backend/tests/db/queries.test.ts` cases for `findForexCandidateTransactions` (array, ±5% amount, ±7-day window, excludes linked) and `linkInvoiceToTransaction` (sets status/confidence/tx id)

### Implementation for User Story 2

- [X] T013 [US2] Add `GET /pwa/import/ambiguous` in `backend/src/handlers/pwa.ts`: for each `ambiguous` invoice (ordered by date) re-derive candidates live — exact (`findMatchingExpenseTransaction`); if empty, forex (`findForexCandidateTransactions`); return invoice header + `candidate_source` + `candidates[]` (`id, transaction_at, amount, note, items`). (depends on T005, T008)
- [X] T014 [US2] Add `POST /pwa/import/resolve` in `backend/src/handlers/pwa.ts`: validate invoice is `ambiguous` and tx exists & unlinked; apply ordered writes (enrich tx → items: `replace_items` ⇒ replace with positive invoice items `replaced`, else fill-if-empty `filled`/`kept` → `linkInvoiceToTransaction` with confidence LAST); return resolved detail; emit the documented error codes. (depends on T005, T013)
- [X] T015 [P] [US2] Create `pwa/src/components/AmbiguousInvoiceCard.tsx`: render invoice seller/amount/date, candidate radio list (date, amount, note, existing items), a keep/replace-items toggle (取代品項), and a 確認 button posting to `/pwa/import/resolve`. (depends on T014 contract)
- [X] T016 [US2] Wire the resolution flow into `pwa/src/screens/ImportScreen.tsx`: when `ambiguous > 0`, fetch `GET /pwa/import/ambiguous` and render an `AmbiguousInvoiceCard` per invoice; on resolve success remove the card and update the summary counts. (depends on T010, T015)

**Checkpoint**: Ambiguous invoices (incl. forex) are resolvable in the PWA; US1 still works.

---

## Phase 5: User Story 3 — Post-Import Summary (Priority: P3)

**Goal**: A clear summary after upload and after each resolution — counts plus per-matched-invoice details (seller, confidence, items outcome) that stay accurate as ambiguous invoices are resolved.

**Independent Test**: Import a mixed CSV; verify all counts are accurate and the matched list shows seller/confidence/items outcome; resolve one ambiguous invoice and verify it moves into the matched section with counts updated.

### Tests for User Story 3 ⚠️

- [X] T017 [P] [US3] Add an SC-004 assertion (matched_exact + matched_near + ambiguous + skipped_unmatched + skipped_duplicate + skipped_voided + skipped_zero == parsed total) to `backend/tests/handlers/pwa-import.test.ts`

### Implementation for User Story 3

- [X] T018 [US3] In `pwa/src/screens/ImportScreen.tsx`, render the per-matched-invoice detail list from the import response `matched[]` (seller, invoice number, confidence 同日/鄰近, items outcome 已填入/保留/已取代). (depends on T010)
- [X] T019 [US3] In `pwa/src/screens/ImportScreen.tsx`, update the summary live after each ambiguous resolution (ambiguous −1; matched_exact/near +1 by resolved confidence) so the resolved invoice appears in the matched section. (depends on T016, T018)

**Checkpoint**: Summary fully reflects auto-matches and manual resolutions.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T020 [P] Run the full backend suite (`cd backend && pnpm test`) and fix any regressions across invoice-matcher / queries / discord / pwa-import tests
- [ ] T021 Deploy step: re-run `cd backend && pnpm tsx scripts/register-commands.ts` to deregister the removed Discord `/import` and `/reconcile` commands (per quickstart.md)
- [ ] T022 Run `specs/022-invoice-import-v2/quickstart.md` end-to-end (import → resolve keep & replace → re-import dedup; verify transaction count unchanged)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 — no dependencies.
- **Foundational (Phase 2)**: T002 needs T001; T003 [P]; T004 then T005 (T005 removes `resolveHeldInvoice`, which T004 must stop referencing first). BLOCKS all user stories.
- **US1 (Phase 3)**: after Foundational. T006/T007 [P] → T008 → T009 → T010.
- **US2 (Phase 4)**: after US1 (needs the pipeline to produce `ambiguous` and the ImportScreen base). T011/T012 [P] → T013 → T014 → T015 [P] → T016.
- **US3 (Phase 5)**: after US1 (T018) and US2 (T019). T017 [P].
- **Polish (Phase 6)**: after all targeted stories.

### Cross-file sequencing notes

- `backend/src/handlers/pwa.ts` is edited by T009, T013, T014 → sequential (same file).
- `pwa/src/screens/ImportScreen.tsx` is layered T010 (US1 base) → T016 (US2 flow) → T018/T019 (US3 details) → sequential (same file).
- `backend/tests/handlers/pwa-import.test.ts` is appended by T007, T011, T017 → sequential.

### Parallel Opportunities

- Foundational: T003 runs parallel to the T004→T005 chain.
- US1 tests: T006 ∥ T007.
- US2 tests: T011 ∥ T012; component T015 ∥ the pwa.ts endpoint work once its contract is fixed.

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup (T001) → Phase 2 Foundational (T002–T005).
2. Phase 3 US1 (T006–T010).
3. **STOP and VALIDATE**: upload a CSV; confirm auto-links, accurate counts, and zero transactions created (SC-003). Deployable MVP — ambiguous invoices show as a count even before resolution exists.

### Incremental Delivery

- + US2 (T011–T016): ambiguous resolution in the PWA (incl. forex candidates).
- + US3 (T017–T019): richer summary + live updates after resolution.
- Polish (T020–T022): green suite, deregister Discord commands, quickstart validation.

---

## Notes

- [P] = different files, no incomplete dependencies.
- Tests are constitution-mandated; verify they fail before implementing (T006/T007 before T008/T009).
- SC-003 (no transactions created) is the load-bearing invariant — assert tx count before/after in T006.
- Migration 020 (T002) and the Discord deregistration (T021) are operational steps run against the live environment, not code edits.
