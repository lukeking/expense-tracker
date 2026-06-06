# Phase 0 — Research & Decisions

Feature: Discount-aware net spend for itemized transactions (025)

All spec clarifications were resolved in the 2026-06-06 session; this records the implementation-level decisions and the code reconnaissance that backs them.

## Decision 1 — Net value carrier: reuse `effective_amount`

- **Decision**: Use the existing `transaction_items.effective_amount` column as the per-item net value the summaries read. No new column, no migration.
- **Rationale**: The column already exists (migrations 015/016/017) and is already written by `computeAndWriteEffectiveAmounts` for manual entries; the aggregators already prefer `effective_amount ?? amount`. The defect is purely that (a) the summary read omits the column and (b) two fill paths never populate it.
- **Alternatives considered**: A new "net_amount" item column (redundant); storing a discount adjustment per fill and deriving net at read time (rejected by FR-007 "spend-correction only" + more write surface).

## Decision 2 — Attribution = proportional, via one shared helper

- **Decision**: Distribute the paid total across items **proportionally to face value**, flooring each share and adding the rounding remainder to the largest-amount item. Extract this exact math (currently inside `computeAndWriteEffectiveAmounts`) into a **pure helper** and call it from both the per-tx DB writer and the bulk import path.
- **Rationale**: Matches the clarified choice and the app's existing apportionment, so manual and invoice paths produce identical numbers; one source of truth prevents drift; remainder-to-largest guarantees items sum exactly to paid (FR-009, ≤1-unit error).
- **Alternatives considered**: Concentrate the discount on one category (rejected in clarification — skews a category); re-implement the math separately in the pipeline (duplication risk).

## Decision 3 — Bulk import computes shares in memory (subrequest budget)

- **Decision**: In `runImportPipeline`, compute each matched transaction's fill-item `effective_amount` **in memory** (the matched tx's paid `amount` and the items are already in hand) and write them via the existing single `bulkInsertTransactionItems` call (extended to carry `effective_amount`).
- **Rationale**: Calling the per-tx DB writer (`computeAndWriteEffectiveAmounts`) inside the match loop would reintroduce O(matches) subrequests and breach feature-024's constant-subrequest design. In-memory shares + one bulk insert keep it constant.
- **Alternatives considered**: Per-tx recompute after import (regresses 024); a Postgres-side trigger (new DB object, violates Simplicity-First, and proportional+remainder math is awkward in SQL).

## Decision 4 — Single-tx fill paths reuse the DB writer

- **Decision**: `POST /import/resolve` calls `computeAndWriteEffectiveAmounts(tx.id, tx.amount)` after `applyInvoiceItems`. `manual-link` already does this (verify with a test only).
- **Rationale**: These touch one transaction per request, so the existing per-tx writer is cheap and avoids duplicating logic.
- **Code reconnaissance**: `resolve` (`pwa.ts:882`) fills but does **not** recompute — confirmed gap. `manual-link` (`pwa.ts:1193`) already recomputes after append — confirmed covered.

## Decision 5 — Backfill = offline idempotent script, scoped to invoice-filled discounted txs

- **Decision**: `scripts/backfill-effective-amounts.ts` selects transactions with invoice-sourced items (`transaction_items.source_invoice_id IS NOT NULL`) whose face total ≠ `transactions.amount`, and recomputes `effective_amount` per tx. Dry-run flag; idempotent; run once at deploy.
- **Rationale**: Manual discounted transactions already hold correct `effective_amount`, so they self-correct via Decision 1 — no backfill needed for them. Only invoice-filled rows have null/gross effective values. A TS script reusing the existing writer keeps one implementation and avoids encoding proportional+remainder math in SQL. Personal-scale data → a linear pass is fine.
- **Alternatives considered**: Recompute `effective_amount` for **all** itemized transactions (broader, still idempotent, but touches manual rows unnecessarily — acceptable fallback if provenance scoping proves fiddly); a SQL migration (awkward remainder rule, new failure mode).

## Decision 6 — No API/PWA change

- **Decision**: `/pwa/summary` and `/pwa/summary/subcategories` response shapes are unchanged; only the numbers become correct. PWA (Recharts) needs no edit.
- **Rationale**: The fix is entirely in how item-level spend is read/stored on the backend. SC-002 (categories ≤ grand total) is an emergent property, not a new field.

## Open risks

- **Edit-after-fill (FR-008)**: `PUT /expense` already recomputes `effective_amount` against the edited amount; needs an explicit regression test, not new code.
- **`amount == null` items**: helper apportions only non-null items; the aggregators' `其他`-remainder path is unaffected — verify with a mixed-items test.
