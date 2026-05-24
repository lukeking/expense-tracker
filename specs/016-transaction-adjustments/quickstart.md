# Quickstart: Transaction Adjustments (016)

End-to-end verification guide for spec 016. Follow these steps in order after implementation.

---

## Prerequisites

- Supabase project running with migrations 001–014 applied.
- `backend/.env` configured with `DATABASE_URL` (for migration scripts).
- `tsx` available (`npx tsx` or via `pnpm` workspace).
- Audit script from spec 015 at `backend/scripts/audit-legacy.ts`.

---

## Step 1 — Apply schema migrations

```bash
# From backend/
supabase db push
# Or manually:
psql $DATABASE_URL -f supabase/migrations/015_transaction_adjustments.sql
psql $DATABASE_URL -f supabase/migrations/016_summary_rpc_v2.sql
```

**Verify**:
```sql
-- Confirm table exists
\d transaction_adjustments

-- Confirm column exists and is backfilled
SELECT count(*) FROM transaction_items WHERE effective_amount IS NULL AND amount IS NOT NULL;
-- Expected: 0 (backfill in migration 015 covers all existing rows)
```

---

## Step 2 — Run the data migration script

```bash
# Dry run first — prints actions without writing
tsx backend/scripts/migrate-016.ts --dry-run

# Review output, then execute
tsx backend/scripts/migrate-016.ts
```

The script output should list:
- Number of category tags migrated from `transactions.tags` → `transaction_items.tags`
- Number of fee/refund transactions converted to adjustments
- The 6 orphan fee/refund row IDs (printed, not modified)
- Number of orphan category tag rows fixed via mapping table
- Number of items_sum_mismatch rows corrected

---

## Step 3 — Verify with the audit script

```bash
tsx backend/scripts/audit-legacy.ts
```

**Expected counts after migration**:

| Check | Before | After |
|-------|--------|-------|
| `category_tag_on_transaction` | 15,157 | **0** |
| `fee_refund_without_parent` | 6 | ≤6 (orphans excluded) |
| `transactions_without_items` | 6 | **0** |
| `orphan_category_tag_on_item` | 24 | **0** |
| `items_sum_mismatch` (rewritten) | 2 | **0** |
| New invariant (effective_amount ≠ paid_total) | — | **0** |

---

## Step 4 — Test the summary RPC

```bash
cd backend && npx wrangler dev
```

Then in a browser or `curl`:
```bash
curl -H "Authorization: Bearer $ANDROID_API_KEY" \
  "http://localhost:8787/pwa/summary?period=all"
```

Category totals should now reflect `effective_amount` (accurate per-category spend, not MSRP totals).

Spot-check: pick a legacy transaction you know had a category tag on the transaction (not the item) before migration. Confirm its category now appears in the summary.

---

## Step 5 — Test the PWA entry flow

```bash
cd pwa && pnpm dev
```

1. Open the expense entry screen.
2. Enter an amount (e.g., NT$450) and at least one item (e.g., NT$300 + NT$200).
3. Expand the "折抵 / 手續費 / 退款" section.
4. Add a discount of NT$50 with note "LINE點折抵".
5. Submit the transaction.

**Verify**:
- No console errors.
- The transaction appears in history with `amount = 450`.
- In the DB: `transaction_adjustments` has one row with `kind = 'discount', amount = 50`.
- `transaction_items.effective_amount` values: item 1 → 270 (= floor(300 × 450 / 500)), item 2 → 180 (= floor(200 × 450 / 500)), sum = 450. ✓
- The category summary reflects 450 (not 500) for the items' categories.

---

## Step 6 — Test validation (negative amount rejection)

In the PWA entry form:
1. Enter amount NT$100 and one item NT$100.
2. Add a discount of NT$150 (exceeds item total).
3. **Expected**: the form should display an error and block submission before the amount would go negative.

---

## Step 7 — Handle orphan fee/refund rows

Read the migration script output from Step 2 for the 6 orphan row IDs. For each:

- If you can identify the parent transaction: edit it in the PWA, add the appropriate adjustment, then delete the orphan transaction.
- If no parent can be identified: evaluate whether to keep as a legacy record or delete.

After manual resolution, re-run the audit script:
```bash
tsx backend/scripts/audit-legacy.ts
```

`fee_refund_without_parent` should now be **0**.

---

## Step 8 — Run the full test suite

```bash
cd backend && pnpm test
```

All existing tests must pass. Pay attention to any test that uses `transaction_items` or the summary RPC — these are the most likely to be affected by the schema change.
