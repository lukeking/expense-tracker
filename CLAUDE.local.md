# Local project notes

## Domain references — read before re-deriving

Durable design/behaviour docs live in `docs/` (index: `docs/README.md`). Consult them
instead of reconstructing the logic from code each session:

- `docs/refund-fee-adjustment-vs-transaction.md` — fee/refund as an **adjustment** vs a
  standalone **transaction** (recurring question; covers `transaction_at` alignment, summary
  signs, 未分類).
- `docs/transaction-adjustments-design.md` — adjustments + `effective_amount` allocation
  (original design; see its banner for what diverged at build time).
- `docs/data-model-philosophy.md` — why the schema is shaped the way it is.
- `docs/invoice-matching-marketplace-multi-invoice.md` — **deferred**: marketplace one-payment/
  N-invoices; matcher is 1:1; approach (b) is currently blocked. Read before touching invoice matching.
