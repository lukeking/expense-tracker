# Data Model: Explicit Payment Method Option for /expense

**Branch**: `006-expense-payment-option`
**Date**: 2026-05-10

## No Schema Changes Required

The `transactions` table already has a `payment_method` column with a `CHECK` constraint enforcing all five valid values:

```sql
payment_method TEXT NOT NULL CHECK (
  payment_method IN ('credit_card', 'prepaid_wallet', 'easy_card', 'bank_account', 'cash')
)
```

## PaymentMethod Enum

| Discord Choice Label | Discord Option Value | Stored Value (`PaymentMethod`) | Display Label |
|---------------------|---------------------|-------------------------------|---------------|
| 現金                 | `cash`              | `cash`                        | `[現金]`       |
| 信用卡               | `credit_card`       | `credit_card`                 | `[信用卡]`     |
| 悠遊卡               | `easy_card`         | `easy_card`                   | `[悠遊卡]`     |
| 銀行轉帳              | `bank_account`      | `bank_account`                | `[銀行轉帳]`   |
| 行動支付              | `prepaid_wallet`    | `prepaid_wallet`              | `[行動支付]`   |

## Display Label Map

Used in `handleExpenseCommand` to render the confirmation message:

```typescript
const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: '現金',
  credit_card: '信用卡',
  easy_card: '悠遊卡',
  bank_account: '銀行轉帳',
  prepaid_wallet: '行動支付',
};
```

## Unchanged Entities

- `Transaction` — no field additions or removals
- `GeminiParseResult` — type signature unchanged; `payment_method` field remains but is no longer populated from description keywords in the Discord flow
