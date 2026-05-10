# Contract: Deterministic Expense Description Parser

**Service**: `backend/src/services/expense-parser.ts`

## Function Signature

```typescript
export interface ParsedDescription {
  paymentMethod: PaymentMethod | null;
  categoryTag: string | null;     // e.g. '食:午餐' — first #tag containing ':'
  plainTags: string[];            // all other #tags (no ':')
  items: { name: string; amount: number }[];
  note: string;                   // concatenated non-item, non-tag, non-payment tokens
  warnings: string[];             // e.g. mismatch warning, multiple-category warning
}

export function parseDescription(description: string, totalAmount: number): ParsedDescription
```

## Parsing Rules (in order of precedence per token)

Given `description.split(',').map(t => t.trim())`:

| Priority | Condition | Classification |
|---|---|---|
| 1 | Starts with `#` and contains `:` | Category tag → `categoryTag` (first occurrence only) |
| 2 | Starts with `#`, no `:` | Plain tag → appended to `plainTags` |
| 3 | Exact match to payment keyword (case-insensitive) | `paymentMethod` |
| 4 | Last whitespace-separated word is numeric | Line item: `name` = prefix, `amount` = number |
| 5 | Everything else | Appended to `note` (space-separated) |

## Payment Keyword Enum

| Keyword(s) | Maps to |
|---|---|
| `現金`, `cash` | `cash` |
| `信用卡`, `credit card`, `credit_card` | `credit_card` |
| `悠遊卡`, `easy card`, `easy_card` | `easy_card` |
| `行動支付`, `line pay`, `google pay`, `apple pay`, `prepaid_wallet` | `prepaid_wallet` |
| `銀行轉帳`, `bank transfer`, `bank_account` | `bank_account` |

## Warnings Generated

| Condition | Warning message |
|---|---|
| Multiple `#category:subcategory` tokens | `⚠️ 僅使用第一個分類標籤 #{first}，其餘忽略` |
| sum(item.amount) ≠ totalAmount | `⚠️ 項目合計 NT$X ≠ 總金額 NT$Y，差額 NT$Z 未歸類` |

## Examples

| Input description | totalAmount | Result |
|---|---|---|
| `信用卡, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50` | 300 | pm=credit_card, categoryTag=食:午餐, note=麥當勞, items=[{大麥克套餐,250},{蘋果派,50}], warnings=[] |
| `悠遊卡, 亞東醫院→忠孝復興, #行:捷運` | 35 | pm=easy_card, categoryTag=行:捷運, note=亞東醫院→忠孝復興, items=[], warnings=[] |
| `現金, #三商巧福` | 80 | pm=cash, categoryTag=null, plainTags=[三商巧福], note='', items=[], warnings=[] |
| `現金, #食:午餐, 大麥克套餐 250, 蘋果派 50` | 350 | pm=cash, categoryTag=食:午餐, items=[...], warnings=['⚠️ 項目合計 NT$300 ≠ 總金額 NT$350，差額 NT$50 未歸類'] |
