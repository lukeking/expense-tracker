# Spec: /audit Command

**Branch**: `012-audit-command` (future) | **Depends on**: `011-transaction-items`

## Problem

Silent data drift. Three known failure modes accumulate unnoticed over time:

1. **Allowance-updated invoice re-imported** — `UNIQUE` on `invoice_number` causes silent skip.
   Matched transaction keeps the original gross amount; summary overstates spending.

2. **Credit note auto-created as new expense** — A refund credit note has a distinct invoice number,
   so the pipeline auto-creates a new expense transaction. Net spending is understated
   (refund recorded as cost) and the original transaction has no refund link.

3. **Forex transaction never reconciled** — Amount estimate was never amended; invoice stays
   `held_forex`; transaction stays at the wrong amount indefinitely.

No current mechanism surfaces any of these. The numbers look plausible so nothing triggers suspicion.

## Goal

A `/audit [month]` command (defaults to current month) that cross-checks data integrity and
highlights anomalies before the user trusts the summary numbers.

## User Stories

**US1 — Allowance drift detection**
As a user, when I run `/audit month`, I see any transaction where
`transactions.amount ≠ invoices.net_amount` on its matched invoice, so I know to investigate.

**US2 — Orphaned auto-created transactions**
As a user, I see auto-created transactions (from import) that have no tags and no items with tags —
likely spurious credit-note records — flagged for review.

**US3 — Unreconciled forex invoices**
As a user, I see invoices still in `held_forex` status older than N days, so I know a
reconciliation is overdue.

**US4 — Unmatched transactions**
As a user, I see expense transactions in the period with no matched invoice, so I can decide
whether to import or accept them as cash/overseas.

**US5 — Summary confidence indicator**
As a user, the audit result tells me "clean" or lists issues, so I know whether to trust
`/summary month` numbers.

## Proposed Discord Output

```
🔍 審計報告 · 2026/05
─────────────────────
✅ 無異常，本月數字可信。
```

Or when issues exist:

```
🔍 審計報告 · 2026/05

⚠️ 金額不符（發票折讓未更新）：1 筆
  · Airbnb NT$1000 → 發票淨額 NT$800（差 NT$200）

⚠️ 疑似孤立退款交易：1 筆
  · 05/12 NT$200 · 無標籤無項目（自動建立）

⏳ 外幣待確認超過 7 天：1 筆
  · AB12345681 NT$1024 · 05/03（已 14 天）

📋 本月無發票交易：3 筆（現金或海外）
  · NT$120 · 05/01
  · NT$450 · 05/08
  · NT$237 · 05/17
```

## Implementation Notes

- All checks are read-only Supabase queries; no writes.
- Allowance drift: join `transactions` with `invoices` on `matched_invoice_id`,
  compare `transactions.amount` vs `invoices.net_amount`.
- Orphaned auto-created: `invoices.match_status = 'auto_created'` AND
  transaction has no tags AND no `transaction_items` with non-empty tags.
- Held forex age: `invoices.match_status = 'held_forex'`, compute days since `invoice_date`.
- Unmatched transactions: reuse `findTransactionsWithoutInvoiceInRange` already used in import summary.

## Out of Scope

- Auto-fixing any of the detected issues (audit is visibility only).
- Historical audit beyond the current or specified month.
- Push notifications / scheduled audit (can be added later via cron).
