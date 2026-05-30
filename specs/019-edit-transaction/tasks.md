# Tasks: Edit Transaction (019)

**Input**: Design documents from `specs/019-edit-transaction/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/api-contract.md ✓, quickstart.md ✓

**Tests**: No automated test tasks — manual smoke test via quickstart.md as final task.

**Organization**: Tasks grouped by user story. US1 (P1) = header edit flow end-to-end. US2 (P2) = items and adjustments editing in the form.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no incomplete dependencies)
- **[Story]**: User story label (US1, US2)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Query function extension needed by the PUT endpoint. Must complete before any user story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T001 Extend `replaceTransactionItems` item parameter type in `backend/src/db/queries.ts` — add `note?: string | null` to the items array element type (no body change needed; `insertTransactionItems` already handles it)

**Checkpoint**: Foundation ready — backend query layer supports `note` on item replace.

---

## Phase 3: User Story 1 — Correct a Mistake (Priority: P1) 🎯 MVP

**Goal**: User can open any expense transaction from history, see all header fields pre-filled, change any header field, and save. Fee/refund rows have no edit entry point. Items are preserved through the save (passed back unchanged).

**Independent Test**: Submit a transaction via the Entry screen. Open it in history via the ✏ button. Change the amount. Tap 儲存. Verify history list reflects the new amount; all other fields unchanged. Verify no ✏ button on fee/refund rows.

- [ ] T002 [US1] Add `GET /pwa/transactions/:id` route in `backend/src/handlers/pwa.ts` — select `id, amount, payment_method, tags, note, transaction_at, transaction_type, transaction_items(id, name, amount, tags, note, sort_order)` from `transactions`; call `getAdjustmentsForTransaction`; return 404 if not found; response shape per `contracts/api-contract.md`; place route after the existing `GET /pwa/transactions` list route

- [ ] T003 [US1] Add `PUT /pwa/transactions/:id` route in `backend/src/handlers/pwa.ts` — validate body (`amount`, `payment_method`, per-item amounts, adjustment fields); fetch transaction and return 404 if missing or 403 if not `expense` type; update header via `supabase.from('transactions').update({amount, payment_method, tags: free_tags, note})`; delete old items then call `insertTransactionItems` with new items (same tag logic as POST /pwa/expense); call `deleteAdjustmentsForTransaction` then `insertAdjustments`; call `computeAndWriteEffectiveAmounts` if items non-empty; return `{ ok: true }`

- [ ] T004 [US1] Create `pwa/src/components/EditExpenseSheet.tsx` — export `EditExpenseSheet({ txId, onClose }: { txId: string; onClose: () => void })` as a `fixed inset-0 z-50` full-screen overlay with a header bar (← 返回 button calls `onClose`, title "編輯支出"); inside use `useQuery({ queryKey: ['tx-detail', txId], queryFn: () => apiFetch<TxDetail>('/pwa/transactions/' + txId) })`; show loading spinner while pending; show error text if query failed; on success render `EditExpenseFormInner` (stub for now — just `<div>loaded</div>`)

- [ ] T005 [US1] Replace stub `EditExpenseFormInner` in `pwa/src/components/EditExpenseSheet.tsx` with the full header-field form — state: `amount` (string, init from `String(tx.amount)`), `paymentMethod` (init from `tx.payment_method`), `category` (CategorySelection | null, init via `parseCategorySelection(deriveCategoryTag(tx.items))`), `freeTags` (init from `tx.tags`), `note` (init from `tx.note ?? ''`); add `parseCategorySelection` and `deriveCategoryTag` helpers per `data-model.md`; `useMutation` calling `PUT /pwa/transactions/:id` with header fields + items passed through unchanged from `tx.items` (mapped to `{name, amount, tag: itemCatTag !== categoryTag ? itemCatTag : null, note}`) + adjustments passed through from `tx.adjustments`; on success: `queryClient.invalidateQueries({queryKey: ['summary']})`, `queryClient.invalidateQueries({queryKey: ['transactions']})`, call `onClose()`; show inline error when `mutation.error` is set (form stays open — FR-008); render Amount input, PaymentPills, CategoryPicker, TagInput, Note input, and 儲存 submit button (disabled when pending or `amountVal <= 0`)

- [ ] T006 [P] [US1] Add edit entry point to `pwa/src/screens/SummaryScreen.tsx` — (1) add `editingTxId: string | null` state to `SummaryScreen`; (2) render `{editingTxId && <EditExpenseSheet txId={editingTxId} onClose={() => setEditingTxId(null)} />}` at top of return (before other JSX); (3) add optional `onEdit?: (id: string) => void` prop to `TxEntry`, `DateSubGroup`, `HistoryGroup`, `LazyHistoryGroup` and thread it through each; (4) in `TxEntry` add a ✏ button (`onClick={e => {e.stopPropagation(); onEdit(tx.id)}}`) visible only when `tx.transaction_type === 'expense' && onEdit`; (5) import `EditExpenseSheet` from `../components/EditExpenseSheet`

**Checkpoint**: User Story 1 complete. Header-field edits work end-to-end. No edit button on fee/refund.

---

## Phase 4: User Story 2 — Update Items and Adjustments (Priority: P2)

**Goal**: User can add, remove, and edit item rows and adjustment rows in the edit form and save. `effective_amount` is recomputed correctly after save.

**Independent Test**: Open an existing transaction with 1 item and 1 adjustment. Add a second item (name + amount). Change the adjustment amount. Tap 儲存. In Supabase, verify `transaction_items` has 2 rows with updated `effective_amount` values. Verify `transaction_adjustments` has 1 row with the new amount.

- [ ] T007 [US2] Add items state to `EditExpenseFormInner` in `pwa/src/components/EditExpenseSheet.tsx` — add `preloadItems(rawItems, categoryTag)` helper per `data-model.md` (maps each DB item to `ItemRowData` with `tagOverride` derived by comparing item's category tag to the derived `categoryTag`, `note ?? ''`, `approxFlag: false`, new `crypto.randomUUID()` as id); initialize `items` state with `useState<ItemRowData[]>(() => preloadItems(tx.items, deriveCategoryTag(tx.items)))`; add `updateItem`, `removeItem` helpers; add `makeOnMax` (identical to `ExpenseForm` in `EntryScreen.tsx`); add `newItem()` helper; update submit payload `items` field to use live `items` state instead of passthrough

- [ ] T008 [US2] Render `ItemRow` list in `EditExpenseFormInner` in `pwa/src/components/EditExpenseSheet.tsx` — add items section with label "品項明細" + item sum display; render `<ItemRow key={item.id} item={item} inheritedTag={categoryTag} extraTags={freeTags} onMax={makeOnMax(item.id)} onChange={...} onRemove={...} />` for each item; add "＋ 新增品項" button appending `newItem()`; show "請至少新增一個品項" warning when `items.length === 0`; import `ItemRow` and `ItemRowData` from `../components/ItemRow`

- [ ] T009 [US2] Add adjustments state to `EditExpenseFormInner` in `pwa/src/components/EditExpenseSheet.tsx` — add `preloadAdjustments(rawAdjs)` helper per `data-model.md` (maps `basis === 'percentage'` → `mode='percentage', value=basis_value`; else `mode='absolute', value=amount`; `note ?? ''`; new `crypto.randomUUID()` as id); initialize `adjustments` state with `useState<AdjustmentRowData[]>(() => preloadAdjustments(tx.adjustments))`; add `showAdj` state (init `adjustments.length > 0`); add ▸/▾ toggle button beside the amount input; render `{showAdj && <div ...><AdjustmentRow ... /> ... <button>＋ 新增折抵</button></div>}`; add `updateAdjustment`, `newAdjustment()` helpers; compute `percentBase` (itemSum > 0 ? itemSum : amountVal); update submit payload `adjustments` field to use live `adjustments` state (same mapping as `ExpenseForm`); import `AdjustmentRow`, `AdjustmentRowData`, `resolveAdjAmount` from `../components/AdjustmentRow`

- [ ] T010 [US2] Add reconciliation row to `EditExpenseFormInner` in `pwa/src/components/EditExpenseSheet.tsx` — copy exact reconciliation block from `ExpenseForm` in `pwa/src/screens/EntryScreen.tsx`; visible when `allItemsHaveAmount && items.length > 0`; displays item sum, each adjustment line, computed paid vs entered amount with ⚠ diff or ✓ (FR-006)

**Checkpoint**: User Stories 1 and 2 both work independently and together.

---

## Phase 5: Polish & Validation

- [ ] T011 Manual smoke test per `specs/019-edit-transaction/quickstart.md` — run all 6 steps: (1) verify edit entry point, (2) pre-fill correctness, (3) edit and save, (4) save without changes, (5) save failure handling, (6) empty items list

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 2)**: No dependencies — start immediately
- **User Story 1 (Phase 3)**: Depends on T001 (foundational)
  - T002 → T003 (sequential; both in `pwa.ts`)
  - T004 → T005 (sequential; both in `EditExpenseSheet.tsx`)
  - T006 [P] can start any time after T004 exists (different file: `SummaryScreen.tsx`)
- **User Story 2 (Phase 4)**: Depends on T005 (form structure established)
  - T007 → T008 → T009 → T010 (sequential; all in `EditExpenseSheet.tsx`)
- **Polish (Phase 5)**: Depends on all prior phases complete

### User Story Dependencies

- **US1**: Depends on T001 only — independently deliverable
- **US2**: Depends on US1 (edit form structure from T004/T005) — extends the same component

### Within Each Story

- Backend (T002, T003) before frontend form (T004, T005) for US1 — cannot test end-to-end otherwise
- Items state (T007) before items render (T008) — state must exist before JSX uses it
- Adjustments state (T009) before reconciliation row (T010) — reconciliation uses `adjustments`

### Parallel Opportunities

- T006 [P] (SummaryScreen) can run alongside T004/T005 (EditExpenseSheet) — different files

---

## Parallel Example: User Story 1

```
# Backend and SummaryScreen entry point can proceed together once T001 is done:
Task T002: GET /pwa/transactions/:id endpoint
Task T006: Edit entry point in SummaryScreen (can start after T004 is created)

# Then form inner:
Task T004 → T005: EditExpenseSheet overlay + form
```

---

## Implementation Strategy

### MVP (User Story 1 only)

1. T001 — Foundational query extension
2. T002, T003 — Backend endpoints
3. T004, T005 — EditExpenseSheet (header fields only)
4. T006 — SummaryScreen entry point
5. **VALIDATE**: Open form, change amount, save, verify history reflects change
6. Fee/refund rows have no ✏ button — confirm SC-004

### Incremental Delivery

1. Complete T001–T006 → MVP: header edits work
2. Add T007–T010 → Full: items and adjustments editable
3. T011 → Smoke test all quickstart scenarios

---

## Notes

- All tasks are in 4 files: `backend/src/handlers/pwa.ts`, `backend/src/db/queries.ts`, `pwa/src/components/EditExpenseSheet.tsx`, `pwa/src/screens/SummaryScreen.tsx`
- No new migrations — feature 018 already added `note` to `transaction_items`
- `ItemRow` and `AdjustmentRow` component props are unchanged (018 contract)
- `transaction_at` is never written by PUT — verified at implementation
- Items state uses new `crypto.randomUUID()` as React keys (DB item ids not reused in form state)
