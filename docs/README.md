# Design & domain docs

Durable references for how this system models money and data. **Read these before
re-deriving behaviour** — the transaction money-model ones in particular have caught us
out more than once.

| Doc | What it covers |
|---|---|
| [data-model-philosophy.md](./data-model-philosophy.md) | The opinionated shape the schema settled into (single-user bias, transaction as aggregate root, `amount` = authoritative paid total, why decisions look the way they do). |
| [transaction-adjustments-design.md](./transaction-adjustments-design.md) | Original design of `transaction_adjustments` + `effective_amount` (discount/fee/refund modifiers, proportional per-item allocation). See its top banner for what shipped vs. what diverged. |
| [refund-fee-adjustment-vs-transaction.md](./refund-fee-adjustment-vs-transaction.md) | Current behaviour + decision guide: when a fee/refund is an **adjustment** vs a standalone **transaction**, the `transaction_at`-aligns-to-parent rule, and how each flows into summaries (signs / 未分類). |
| [invoice-matching-marketplace-multi-invoice.md](./invoice-matching-marketplace-multi-invoice.md) | **Deferred design note**: marketplace orders = one payment but N seller-invoices; why the 1:1 matcher can't reconcile them, current support level (a works, b is blocked), and the chosen direction (manual multi-invoice linking) if/when built. |
