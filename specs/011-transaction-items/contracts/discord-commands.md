# Contract: Discord Command Schemas (transaction_items changes)

## /expense (extended)

**Unchanged signature**: `/expense amount:<number> description:<string> [payment_method:<enum>]`

**Extended description parsing** — multi-item format:

```
/expense 180 全家,#食:早餐 便當 60,#醫:藥 感冒藥 120
```

Token grammar (comma-separated):
```
token         ::= plain-tag | category-item | plain-item | note-text
plain-tag     ::= '#' word               -- no colon → transaction-level tag
category-item ::= '#' category ':' subcat SPACE name [SPACE amount]
                                         -- colon → item-scoped category tag
plain-item    ::= name SPACE number      -- no leading '#', last word is numeric
note-text     ::= any other text         -- goes into transaction note
```

**Backwards compatibility**: All existing single-tag formats continue to work unchanged:
```
/expense 120 #食:午餐 便當        → single item, amount=120, tags=[食:午餐]
/expense 120 便當 #食:午餐        → same result (tag anywhere in token)
/expense 120 #午餐                → plain tag (no colon) — transaction-level only
```

**Response** (unchanged structure, updated data source):
```
✅ NT$180 · 全家 [現金 · #食:早餐]
  · 便當 NT$60
  · 感冒藥 NT$120
📊 本月支出：$X,XXX / $X,XXX (XX%)
```

Items are now read back from `transaction_items` table, not from JSONB.
Warning still shown if item amounts exceed transaction total.

---

## /fee

**Unchanged**: single-item transaction; the fee description becomes the one item with full amount. No per-item category tag support needed (fees are always `其他` or a single known category).

---

## /refund

**Unchanged signature**. Refund items follow the same extended token grammar as `/expense`.

---

## /amend (extended behaviour)

**Unchanged signature**: `/amend amount:<number> [parent:<string>]`

**New cascade behaviour after selection**:

| Item state | Cascade action |
|------------|----------------|
| 1 item, item.amount == old transaction.amount | Update both transaction.amount and item.amount |
| 1+ items, any have explicit amounts ≠ old total | Warn user: "⚠️ 項目金額需手動更新" — update transaction.amount only |
| Items with no amounts | Update transaction.amount only, no warning |

**Updated confirmation message**:
```
✅ 已修正：便當 NT$100 → NT$110
📊 本月支出：$X,XXX / $X,XXX (XX%)
```

---

## /summary (unchanged command, updated data)

**No signature change.** The command output format is identical. The underlying aggregation now uses `transaction_items.amount` and `transaction_items.tags` instead of `transactions.tags`.

Transactions with no categorised item amounts appear under `其他` exactly as before.

---

## /import (invoice import, extended item writing)

When an invoice is imported and matched to a transaction, the invoice line items are written to `transaction_items`:

**Matching rules**:
- If the matched transaction has items with no amounts → populate amounts from invoice line items in order
- If item count differs between transaction and invoice → show a warning listing the existing item names being discarded, then replace transaction items entirely with invoice line items (preserving the transaction's tags)
- If transaction items already have amounts → do not overwrite

**Warning message format** (count mismatch case):
```
⚠️ 發票項目與記錄不符，以下項目將被取代：
  · 便當
  · 感冒藥
已更新為發票內容（3 項）。
```

**Invoice line item → transaction_item mapping**:
```
invoice.items[n].name        → transaction_items.name
invoice.items[n].amount      → transaction_items.amount
(inferred from seller type)  → transaction_items.tags  [best-effort, may be empty]
invoice.items[n] index       → transaction_items.sort_order
```
