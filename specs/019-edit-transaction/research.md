# Research: Edit Transaction (019)

## Existing infrastructure audit

### Decision: No migration required
**Rationale**: All required DB columns exist. `transaction_items` already has `note` (018). `transaction_adjustments` has all fields needed for replace-and-reinsert. The `transactions` table has all header fields (`amount`, `payment_method`, `tags`, `note`).

### Decision: Reuse existing query functions
**Rationale**: `deleteAdjustmentsForTransaction`, `insertAdjustments`, `insertTransactionItems`, `computeAndWriteEffectiveAmounts` cover the PUT endpoint's needs. The delete + reinsert pattern for items is already used in `replaceTransactionItems`; that function needs `note` added to its item type to be usable here.

### Decision: `replaceTransactionItems` extended, not duplicated
**Rationale**: The function already exists and handles the delete-then-insert pattern. Adding `note?: string | null` to its item parameter type is the surgical change — no new function.

### Decision: GET /pwa/transactions/:id returns items + adjustments inline
**Rationale**: The edit form needs both in a single load to avoid two round-trips and a complex loading state. The response shape mirrors what PUT expects, making the pre-fill trivial.

### Decision: Category tag pre-fill from item tags
**Rationale**: The backend stores `category_tag` on items (not on the transaction header). On pre-fill: extract the first category tag (containing `:`) found across all items; items whose tag matches that category tag get `tagOverride = null`; items with a different tag get `tagOverride = <their tag>`.

### Decision: EditExpenseSheet as a full-screen overlay rendered in SummaryScreen
**Rationale**: Avoids new router routes and lazy-loaded chunks. The overlay is controlled by `editingTxId: string | null` state in `SummaryScreen`. This matches the BottomSheet pattern already used in the app for full-screen sub-views.

### Decision: Adjustment pre-fill maps DB row → AdjustmentRowData
- `mode`: `basis === 'percentage' ? 'percentage' : 'absolute'`
- `value`: `basis === 'percentage' ? basis_value : amount`
- `note`: `note ?? ''`
- `id`: new `crypto.randomUUID()` (UI key only; DB id not needed in form state)

### Decision: PUT validates transaction_type = 'expense' before writing
**Rationale**: Prevents accidental edits to fee/refund rows via direct API calls; consistent with SC-004.

### Alternatives considered
- **Separate route `/edit/:id`**: Rejected — adds router config and lazy chunk for minimal gain; the overlay pattern works well in this PWA.
- **New `updateTransaction` query function**: Rejected — a direct Supabase `.update()` call in the handler is simpler; the pattern is established throughout `pwa.ts`.
- **Reuse GET /pwa/transactions list for pre-fill**: Rejected — list endpoint omits item `note` and adjustment fields; a dedicated detail endpoint is cleaner.
