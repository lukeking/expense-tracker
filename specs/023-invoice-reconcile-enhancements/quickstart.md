# Quickstart — Invoice Reconciliation Enhancements

Manual verification of the three enhancements. Backend runs locally against Supabase; PWA
dev server up. Builds on feature 022.

## Prerequisites

- Apply migration `022_invoice_reviewed_at.sql`.
- Existing matched invoices on record (from prior imports) for US1.
- For US2: an expense recorded as **paid 35 with a NT$5 discount adjustment** (gross 40),
  same day as an invoice for **40**.
- For US3: a transaction with a **placeholder item** (e.g. `早餐` / tag 食:早餐) that one
  invoice line corresponds to.

```bash
cd backend && pnpm dev
cd pwa && pnpm dev
```

## US1 — Review queue

1. Open the Import screen. The 已配對發票 list shows matched invoices; each has a **已讀**
   action and the section has a **全部標為已讀** action.
2. Mark one as read → it leaves the list; reopen the screen → it stays gone.
3. **全部標為已讀** → list empties; reopen → still empty.
4. Toggle **顯示已讀** → acknowledged matches reappear and each is still **解除**-able;
   un-link one and confirm it reverts (provenance items removed, tx count unchanged).
5. Awaiting-resolution (待手動確認) invoices are unaffected by any mark-as-read action.
6. **SC-002**: with many matched invoices on record, opening the screen is fast
   (only unread load; one batched transaction query — verify no per-invoice round-trips).

## US2 — Discount-aware matching

7. Import the 40 invoice for the same day as the paid-35/gross-40 expense → it
   **auto-links** to that expense (confidence 鄰近, since paid ≠ face value).
8. An expense with **no** discount → matching behaves exactly as before (regression check).
9. Two expenses whose gross both equal one invoice → that invoice stays **ambiguous**
   (never silently auto-linked).

## US3 — Per-item replace in manual link

10. Manually link an invoice to a transaction that has a placeholder item. In the sheet,
    choose to **replace** the placeholder with one invoice line (rather than append).
11. Confirm → the placeholder's **name** becomes the invoice line's name; its **amount,
    effective amount, and tags are unchanged**; no duplicate item; other invoice lines are
    not added.
12. Un-link that invoice later → the renamed item **survives** (it kept
    `source_invoice_id = NULL`); only invoice-appended items are removed.

## Acceptance checks

- **SC-001**: review list shows only unacknowledged matches; fully reviewed = empty, stays empty.
- **SC-002**: Import screen opens in <1 s regardless of historical matched count.
- **SC-003**: transaction count unchanged across mark-as-read, import (discount-aware), manual link, replace, un-link.
- **SC-004**: a discounted expense recorded with its discount auto-links to its full-price invoice, zero manual steps.
- **SC-005**: replace leaves exactly one item for that line (renamed), no unrelated invoice lines added.
