# Data Model: Discord Fee & Refund Commands

**Feature**: 003-discord-fee-refund | **Date**: 2026-05-09

---

## No New Entities

This feature uses the existing `transactions` table exclusively. The `transaction_type`, `parent_transaction_id`, `items`, `note`, `payment_method`, and `wallet` columns already exist.

---

## Transaction Rows Created by /fee

| Field | Value |
|-------|-------|
| `transaction_type` | `'fee'` |
| `amount` | From `/fee amount:` option (positive integer, NTD) |
| `payment_method` | `'credit_card'` (default — foreign fees are credit card charges) |
| `wallet` | `null` |
| `bank_name` | `null` |
| `items` | `[{ name: description ?? "國外交易服務費", amount: fee_amount }]` |
| `note` | Same as `description ?? "國外交易服務費"` |
| `tags` | `[]` |
| `parent_transaction_id` | `null` at insert; updated to parent UUID on button click |
| `discord_message_id` | Set after `patchInteractionMessage` returns (same as `/expense` flow) |
| `transaction_at` | `new Date().toISOString()` at insert time |

## Transaction Rows Created by /refund

| Field | Value |
|-------|-------|
| `transaction_type` | `'refund'` |
| `amount` | From `/refund amount:` option (positive integer, NTD) |
| `payment_method` | `'cash'` (default — refund method unknown at entry time) |
| `wallet` | `null` |
| `bank_name` | `null` |
| `items` | `[{ name: description ?? "退款", amount: refund_amount }]` |
| `note` | Same as `description ?? "退款"` |
| `tags` | `[]` |
| `parent_transaction_id` | `null` at insert; updated to parent UUID on button click |
| `discord_message_id` | Set after `patchInteractionMessage` returns |
| `transaction_at` | `new Date().toISOString()` at insert time |

---

## getMonthlySpend Fix

**Current behaviour**: `SELECT amount FROM transactions WHERE transaction_at IN [month range]` → `SUM(amount)` unconditionally.

**Required behaviour**: `SELECT amount, transaction_type FROM transactions WHERE transaction_at IN [month range]` → `SUM` applying sign:

```
net_spend = Σ expense.amount + Σ fee.amount − Σ refund.amount
```

This matches the formula ratified in spec 002 clarification and is now required because refund rows will exist.

---

## New Query: findParentCandidates

```typescript
findParentCandidates(
  supabase: SupabaseClient,
  searchTerm: string,
  windowDays: number   // 90
): Promise<Pick<Transaction, 'id' | 'amount' | 'items' | 'note' | 'transaction_at'>[]>
```

**Supabase query**:
```
SELECT id, amount, items, note, transaction_at
FROM transactions
WHERE transaction_type = 'expense'
  AND transaction_at >= now() - INTERVAL '{windowDays} days'
  AND (items::text ILIKE '%{searchTerm}%' OR note ILIKE '%{searchTerm}%')
ORDER BY transaction_at DESC
LIMIT 5
```

**Returns**: Up to 5 rows. Caller formats button labels as `NT${amount} · MM/DD HH:MM` (UTC+8).

---

## custom_id Encoding

| Action | Format | Max length |
|--------|--------|-----------|
| Link to parent | `fee_link:{fee_tx_id}:{parent_tx_id}` | 82 chars ✅ |
| Keep unlinked | `fee_unlink:{fee_tx_id}` | 46 chars ✅ |
| Link to parent | `refund_link:{fee_tx_id}:{parent_tx_id}` | 85 chars ✅ |
| Keep unlinked | `refund_unlink:{fee_tx_id}` | 49 chars ✅ |

All within Discord's 100-character `custom_id` limit.
