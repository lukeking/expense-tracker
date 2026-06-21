# Refund / Fee: adjustment vs. transaction — how it actually works

**Status**: Living reference for the *implemented* behaviour (not a design proposal). Written
because this distinction keeps coming up. Complements
[`transaction-adjustments-design.md`](./transaction-adjustments-design.md) — note that the
design doc's migration plan (step 4) intended to *fold standalone fee/refund transactions
into adjustments and delete them*. **That did not become the standing design** — both
mechanisms exist on purpose, which is the source of the recurring confusion this doc resolves.
*One historical exception:* migration **016 step C3** (`c3ConvertFeeRefundTransactions`) did
run that fold once, on parent-linked rows, which silently stranded some refunds — see
[Pitfall: a refund/fee adjustment doesn't subtract on its own](#pitfall-a-refundfee-adjustment-doesnt-subtract-on-its-own).

**Scope**: when a fee or refund should be a `transaction_adjustments` row vs. a standalone
transaction with `transaction_type ∈ {fee, refund}`.

---

## TL;DR decision

| Situation | Use |
|---|---|
| **Any refund** (normal case) | **refund transaction**, linked to the original via `parent_transaction_id` |
| Fee that is part of the **same bill / same payment** | **adjustment** (`kind: 'fee'`) |
| Fee that is a **separate charge** (different party / settlement) | **fee transaction** |
| Any discount / coupon / point credit | **adjustment** (`kind: 'discount'`) — there is no discount transaction type |

Concrete fee examples:
- 餐廳服務費 +10% → **adjustment** (part of the one bill)
- 政府平台轉帳繳費多收的手續費 → **adjustment** (part of that one payment)
- 國外交易服務費 (foreign-transaction fee) → **fee transaction** (a separate issuer charge,
  usually a separate statement line at a different time)

The principle for fees: **same payment event → adjustment; separate charge → fee transaction.**
Refunds are almost always a separate later event, so they default to a transaction (linked).

---

## The two mechanisms

### 1. Adjustment — a modifier *inside* one transaction

`transaction_adjustments` (migration `015_transaction_adjustments.sql`), one row per modifier
hanging off a parent transaction:

```text
kind            'fee' | 'refund' | 'discount'   (sign implied by kind)
amount          INT > 0
transaction_at  = the parent transaction's time
basis/basis_value   annotation only — the math never reads them
ON DELETE CASCADE   dies with the parent
```

- It does **not** create a separate row in any summary. It is folded into the parent's
  `amount` (the actual paid total), and `effective_amount` redistributes that paid total
  across the parent's items (`computeEffectiveShares` in `backend/src/db/queries.ts`).
- Source of truth is the user-entered **paid amount**, reconciled on the entry form by
  `SUM(items) − discount − refund + fee = paid` (`pwa/src/screens/EntryScreen.tsx`).
- Only **discount** adjustments feed invoice matching (gross = paid + discounts;
  `fetchDiscountSumsByTransaction`, see the invoice matcher). `fee`/`refund` adjustments do
  not participate in matching.

### 2. Refund / fee transaction — a standalone, linkable transaction

`transaction_type ∈ {expense, refund, fee}` (`backend/src/types.ts`), created via
`POST /pwa/refund` and `POST /pwa/fee` (`backend/src/handlers/pwa.ts`):

- A separate transaction with its own `payment_method` (fee defaults to `credit_card`).
- Contributes to summaries with a **sign**: `classify()` in `backend/src/services/summary.ts`
  uses `refund → −1`, everything else (incl. `fee`) `→ +1`. So a fee transaction counts as
  spend; a refund subtracts.
- Optionally links to the original purchase via `parent_transaction_id`.

---

## The key subtlety: `transaction_at` is aligned to the parent

When a refund/fee transaction is written **with** a `parent_transaction_id`, the handler
**deliberately copies the parent's `transaction_at`** (`POST /pwa/fee` and `POST /pwa/refund`):

```ts
let transaction_at = new Date().toISOString();      // default: now
if (parent_transaction_id) {
  const { data: parent } = await supabase.from('transactions')
    .select('transaction_at').eq('id', parent_transaction_id).single();
  if (parent) transaction_at = parent.transaction_at; // align to the original
}
```

Consequences:

- A **linked** refund/fee lands in the **same reporting period** as the original purchase, so
  the offset hits the correct month even if you record it weeks later (a June-recorded refund
  for a May purchase still reduces May).
- The **real** event time is not lost — it stays in `created_at`. The UI shows it as
  「於 {date} 實際退款 / 計費」 using `created_at`, while `transaction_at` is the accounting date.
- An **unlinked** refund/fee uses `transaction_at = now()`, so it falls in the current period.

So the "which period?" difference only applies to **unlinked** refund/fee transactions. A
linked refund transaction and a refund adjustment both land in the original period.

---

## How each shows up in the category breakdown

- **Adjustment**: never a separate slice. It is already inside the parent's `amount` /
  `effective_amount`, under the parent's category.
- **Refund transaction**: a separate signed contribution. If it has a parent, `enrichRefundTags`
  (`backend/src/handlers/pwa.ts`) borrows the parent's category tag so the refund nets against
  the right category. With no category and no parent enrichment it falls into **未分類**
  (feature 031). Note: the `/pwa/transactions` list does **not** enrich refund tags, so a
  parent-less / untagged refund can show under 未分類 in the list while the summary bars
  attribute it to the parent's category — a known, accepted minor discrepancy.
- **Fee transaction**: a separate `+` contribution under its own (usually empty) category →
  also 未分類 unless tagged.

---

## Pitfall: don't double-count

The same refund recorded **both** ways (an adjustment shrinking the parent **and** a separate
refund transaction) will subtract twice. Pick one:

- part of the original purchase, at the same moment → **adjustment**
- a distinct event you still want booked against the original → **refund transaction (linked)**

---

## Pitfall: a `refund`/`fee` adjustment doesn't subtract on its own

An adjustment row is **descriptive of an already-net amount**, not a mutator that subtracts.
Totals flow from the parent's `amount` (the net paid) redistributed into `effective_amount`,
and:

- `effective_amount` is reduced **only by `discount` adjustments** (`computeEffectiveShares` /
  `fetchDiscountSumsByTransaction`, `kind = 'discount'`). `fee`/`refund` adjustments never touch it.
- `classify()` (`backend/src/services/summary.ts`) only applies a sign to refund/fee
  **transactions** — it never reads `transaction_adjustments`.

So a refund entered on the **entry form** works only because the user types the **net** paid
`amount` (`SUM(items) − refund = paid`); the adjustment row just annotates the split. By
contrast, a `refund`/`fee` adjustment **added to an existing transaction without lowering its
`amount`** is **completely inert** — it moves no total and shows in no slice. The refund
silently vanishes.

This is exactly what happened to the 高鐵 reimbursements: migration **016 step C3** turned each
parent-linked refund *transaction* (which had been subtracting via sign) into a `kind='refund'`
adjustment and deleted the original — but never lowered the parents' `amount`/`effective_amount`,
so those refunds stopped counting. Recovery: re-materialise them as refund **transactions**
(linked), which subtract via sign again — *don't* leave a `refund` adjustment expecting it to
subtract. (See also [Pitfall: don't double-count](#pitfall-dont-double-count) — the inverse trap.)

## Code map

| Concern | Location |
|---|---|
| Adjustment table | `backend/supabase/migrations/015_transaction_adjustments.sql` |
| Adjustment CRUD + effective_amount recompute | `backend/src/db/queries.ts` (`computeEffectiveShares`, `computeAndWriteEffectiveAmounts`, `getAdjustmentsForTransaction`) |
| Adjustment write on expense | `POST/PUT /pwa/transactions`, `PUT /pwa/transactions/:id/adjustments` (`backend/src/handlers/pwa.ts`) |
| Refund/fee transactions | `POST /pwa/refund`, `POST /pwa/fee` (`backend/src/handlers/pwa.ts`) |
| `transaction_at` alignment | the `parent_transaction_id` branch in the two handlers above |
| Refund category enrichment | `enrichRefundTags` (`backend/src/handlers/pwa.ts`) |
| Summary signs / 未分類 routing | `classify()` (`backend/src/services/summary.ts`) |
| `effective_amount` nets **only `discount`** adjustments | `fetchDiscountSumsByTransaction`, `computeEffectiveShares` (`backend/src/db/queries.ts`) |
| Historical fold (016 C3) that stranded parent-linked refunds | `c3ConvertFeeRefundTransactions` (`backend/scripts/migrate-016.ts`) |
| Entry-form reconciliation (`SUM(items) − discount − refund + fee = paid`) | `pwa/src/screens/EntryScreen.tsx` |
