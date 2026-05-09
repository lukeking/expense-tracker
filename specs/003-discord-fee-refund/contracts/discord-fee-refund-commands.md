# Contract: Discord /fee and /refund Commands

**Feature**: 003-discord-fee-refund | **Date**: 2026-05-09
**Handler file**: `backend/src/handlers/discord.ts`
**Registration**: `backend/scripts/register-commands.ts`

---

## /fee Command

Record a foreign transaction service fee linked to a prior expense.

### Command Definition

```json
{
  "name": "fee",
  "description": "記錄外幣交易服務費，連結至原始消費",
  "options": [
    {
      "name": "amount",
      "description": "服務費金額 (NTD)",
      "type": 4,
      "required": true,
      "min_value": 1
    },
    {
      "name": "description",
      "description": "費用名稱（預設：國外交易服務費）",
      "type": 3,
      "required": false
    },
    {
      "name": "parent",
      "description": "原始消費關鍵字，用於搜尋母交易（例：Airbnb）",
      "type": 3,
      "required": false
    }
  ]
}
```

### Handler Flow

```
/fee amount:47 description:國外交易服務費 parent:Airbnb
        │
        ▼
Return { type: 5 }  ← immediate deferred response
        │
        ▼ (waitUntil)
Validate amount > 0
        │
        ▼
insertTransaction({
  amount: 47,
  transaction_type: 'fee',
  payment_method: 'credit_card',   ← default for fees
  items: [{ name: "國外交易服務費", amount: 47 }],
  tags: [],
  note: "國外交易服務費",
  parent_transaction_id: null,     ← always null at insert time
  transaction_at: now
})
        │
        ├─ parent option provided? ──YES──► findParentCandidates(supabase, "Airbnb", 90)
        │                                           │
        │                              ┌────────────┴───────────┐
        │                         candidates               no candidates
        │                              │                        │
        │                      Show button message      patchInteractionMessage(
        │                      (see Button Message       "No match — saved unlinked\n
        │                       spec below)              NT$47 · 國外交易服務費\n
        │                                                budget summary")
        │
        └─ parent omitted? ──────────► patchInteractionMessage(
                                        "✅ 記帳成功（未連結）\n
                                         NT$47 · 國外交易服務費\n
                                         budget summary")
```

### Button Message (when candidates found)

```
💳 費用記錄暫存，請選擇母交易：
NT$47 · 國外交易服務費

[NT$1,200 · 04/30 14:23]  [NT$380 · 03/15 09:10]  [NT$800 · 02/28 20:45]
[儲存（不連結）]
```

Button `custom_id` formats:
- Candidate: `fee_link:{fee_tx_id}:{parent_tx_id}` (max ~82 chars, within 100-char limit)
- Unlinked:  `fee_unlink:{fee_tx_id}`

### Component Interaction: fee_link

Triggered when user clicks a candidate button.

```
custom_id: fee_link:{fee_tx_id}:{parent_tx_id}
        │
        ▼
UPDATE transactions SET parent_transaction_id = {parent_tx_id} WHERE id = {fee_tx_id}
        │
        ▼
getBudgetProgress()
        │
        ▼
Return { type: 4, data: { content: "✅ 費用已連結！\n..." } }
```

Response message:
```
✅ 費用已連結！
💰 NT$47 · 國外交易服務費
🔗 已連結至：NT$1,200 (04/30)
📊 本月支出：$X / $Y (Z%)
```

### Component Interaction: fee_unlink

Triggered when user clicks "儲存（不連結）".

```
custom_id: fee_unlink:{fee_tx_id}
        │
        ▼
getBudgetProgress()   ← row already inserted, no DB write needed
        │
        ▼
Return { type: 4, data: { content: "✅ 費用已儲存（未連結）\n..." } }
```

---

## /refund Command

Record a refund or business reimbursement linked to a prior expense.

### Command Definition

```json
{
  "name": "refund",
  "description": "記錄退款或出差請領，連結至原始消費",
  "options": [
    {
      "name": "amount",
      "description": "退款金額 (NTD)",
      "type": 4,
      "required": true,
      "min_value": 1
    },
    {
      "name": "description",
      "description": "退款說明（預設：退款）",
      "type": 3,
      "required": false
    },
    {
      "name": "parent",
      "description": "原始消費關鍵字，用於搜尋母交易（例：高鐵）",
      "type": 3,
      "required": false
    }
  ]
}
```

### Handler Flow

Identical to `/fee` except:
- `transaction_type: 'refund'`
- `payment_method: 'cash'` (default — refunds return to original payment method, unknown at entry time)
- Default description: `"退款"`
- `custom_id` prefix: `refund_link:` / `refund_unlink:`
- Confirmation message prefix: `✅ 退款已連結！` / `✅ 退款已儲存（未連結）`

Budget impact: refund rows are subtracted in `getMonthlySpend` (see below).

---

## findParentCandidates Query

New function in `backend/src/db/queries.ts`.

```typescript
findParentCandidates(
  supabase: SupabaseClient,
  searchTerm: string,
  windowDays: number   // always 90 for this feature
): Promise<Transaction[]>
```

**Query logic:**
- `transaction_type = 'expense'`
- `transaction_at >= now − windowDays days`
- `items::text ILIKE %searchTerm%` OR `note ILIKE %searchTerm%`
- `ORDER BY transaction_at DESC`
- `LIMIT 5`

**Returns** up to 5 `Transaction` rows. Caller constructs button labels from `amount` and `transaction_at`.

---

## getMonthlySpend Bug Fix

**Current** (`queries.ts:52`):
```typescript
return (data ?? []).reduce((sum, row) => sum + (row.amount as number), 0);
```

**Fixed:**
```typescript
return (data ?? []).reduce((sum, row) => {
  const amount = row.amount as number;
  return row.transaction_type === 'refund' ? sum - amount : sum + amount;
}, 0);
```

**Select** must include `transaction_type` in addition to `amount`:
```typescript
.select('amount, transaction_type')
```

This implements the formula from spec 002: `Budget = Σ(expense) + Σ(fee) − Σ(refund)`.

---

## Button Label Format

```
NT$1,200 · 04/30 14:23
```

- Amount: formatted with `toLocaleString()` (adds commas)
- Separator: ` · ` (middle dot with spaces)
- Date + time: `MM/DD HH:MM` extracted from `transaction_at` in UTC+8
- Maximum observed length: ~28 chars (e.g. `NT$12,345 · 12/31 23:59`), well within 80-char limit
- Rationale: `HH:MM` distinguishes same-amount same-day transactions (e.g. two coffee visits)

---

## Constraints Summary

| Constraint | Value | Notes |
|-----------|-------|-------|
| Discord button label max | 80 chars | `NT$amount · MM/DD` ≈ 16–22 chars ✅ |
| Discord buttons per message | 25 max (5×5 rows) | We show max 5 candidates + 1 unlink = 6 buttons, 2 rows ✅ |
| Discord custom_id max | 100 chars | `fee_link:` + 36 + `:` + 36 = 82 chars ✅ |
| Discord interaction token TTL | 15 minutes | Acceptable for fee/refund entry |
