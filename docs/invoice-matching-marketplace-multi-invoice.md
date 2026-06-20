# Marketplace orders: one payment, many invoices (deferred design note)

**Status**: **Deferred — not built.** Recorded so we don't re-derive it (this has come up
during daily use). Revisit when volume or annoyance justifies it.

## Problem

E-commerce marketplaces (Coupang-style 商家機制) issue a **separate e-invoice per seller**, so
one checkout / one card charge produces **N invoices from M sellers**. Real example — a NT$1,067
Coupang order → **3 seller-invoices**:

| 發票 | 賣方 | 內容 | net |
|---|---|---|---|
| BR50084559 | 羅堡羅 | 短褲 299 + **運費 45** | 344 |
| BR38870883 | 酷澎 | 菜脯 125 + 無塵布 199 | 324 |
| BJ86927403 | 杉旺 | 工裝褲 399 | 399 |

The invoice matcher is **1 invoice ↔ 1 transaction, by amount**, so a single lump transaction
can't reconcile with N invoices. (Note: 運費 is a *line item on its seller's invoice*, not a
platform-level charge — so it belongs to that seller's record, not a standalone fee tx.)

## Two ways to enrich such an order, and the chosen direction

- **a) Split the record into N transactions** (one per invoice).
- **b) Let one transaction bind N invoices** (payment = unit of record).

**Direction: prefer (b).** For a *personal* tracker the unit of record is the **payment** — you
reconcile to your card statement and think "one Coupang order", not "three seller purchases".
Per-invoice granularity is a *business*-accounting grain (進項憑證 per 統編). (a) fragments one
payment into N records **and** forces you to know the seller split at entry time — which you
don't; you only learn it days later when 載具 invoices arrive. See
[`data-model-philosophy.md`](./data-model-philosophy.md) (payment as aggregate root) and
[`refund-fee-adjustment-vs-transaction.md`](./refund-fee-adjustment-vs-transaction.md).

**Make (b) tractable without a scary matcher:** keep **auto-match 1:1** (covers the common
single-invoice case unchanged); handle marketplace orders via **manual multi-invoice linking** —
the human groups (they know which invoices are their order), the system only **reconciles
`sum(linked invoices) ≈ tx.amount`**. Do **not** build auto subset-sum grouping (combinatorial,
ambiguous across same-day orders, false-match-prone).

## Current support level (verified in code)

- **a) is fully supported today** — no changes. Each per-seller tx auto-matches its invoice 1:1;
  the existing per-tx item-categorization prompt flow applies. The only cost is manually splitting
  the entry.
- **b) is NOT supported — it's actively blocked:**
  - `POST /pwa/import/resolve` returns **`409 TRANSACTION_ALREADY_LINKED`** when
    `tx.matched_invoice_id` is already set (`backend/src/handlers/pwa.ts`).
  - `transactions.matched_invoice_id` is a **singular** back-ref (one invoice per tx); auto-match
    is 1:1.
  - **Groundwork that already exists for (b):** `invoices.matched_transaction_id` has **no UNIQUE
    constraint** (N→1 is representable), and invoice-created items carry **provenance** (unlink
    removes only that invoice's items) — so multiple invoices' items can coexist on one tx cleanly.

## What building (b) would require

1. Relax the `409` guard to allow N invoices → 1 tx.
2. Rethink the singular `transactions.matched_invoice_id` — use `invoices.matched_transaction_id`
   as the source of truth (or a "representative invoice"); update the matched-status and unlink
   logic for 1:N.
3. **Sum reconciliation** (`sum(linked invoices) ≈ tx.amount`, with tolerance + feedback) instead
   of per-invoice amount equality.
4. **Multi-select manual-link UX** in the unmatched/ambiguous queue.

***Not* required: the item-categorization prompt flow.** It is already per-tx and handles multiple
items per transaction, so the N invoices' merged line items flow through the existing sheet
unchanged — (b) needs no new item-categorization UX.

**Recording-habit prerequisite for (b):** record the full payment (incl. shipping) as **one** tx;
don't carve 運費 into a separate fee tx. Then `sum(invoices) = tx.amount`, and 運費 arrives as an
item line — which also settles the earlier fee-tx-vs-adjustment debate (it's neither; it's a line
item on its seller's invoice).

## Priority / frequency

Only e-commerce marketplaces hit this — physical stores (百貨 / 雜貨 / 免稅店) don't split invoices
(no reason to make extra tax work for themselves). E-commerce averages **< 5 orders/month**; even
if every one were a split-invoice marketplace order, that's **≤ 5/month**. Low but not ignorable →
**defer**, revisit if it grows or starts to annoy.

**Until built**, per marketplace order: either accept it **unmatched** (the matcher is
enrichment-only — it never auto-creates or corrupts), and note items manually; or use **(a)** for
a specific order when you want its enrichment.

## Code map

| Concern | Location |
|---|---|
| 1:1 link guard (`TRANSACTION_ALREADY_LINKED`) | `POST /pwa/import/resolve` — `backend/src/handlers/pwa.ts` |
| Auto-match (per-invoice net = tx paid / paid+discount) | `backend/src/services/invoice-matcher.ts` |
| Schema (`invoices.matched_transaction_id` no-unique; `transactions.matched_invoice_id` singular) | `backend/supabase/migrations/004_einvoice_import.sql` |
| Item provenance / unlink | `enrichTransaction`, `applyInvoiceItems`, unlink handler — `backend/src/handlers/pwa.ts`, `backend/src/db/queries.ts` |
