# Contract: Discord `/expense` Command Schema

**Feature**: 006-expense-payment-option  
**Changed from**: existing `/expense` without `payment_method` option

## Updated Command Definition

```json
{
  "name": "expense",
  "description": "記錄一筆支出",
  "options": [
    {
      "name": "amount",
      "description": "金額 (NTD)",
      "type": 4,
      "required": true,
      "min_value": 1
    },
    {
      "name": "description",
      "description": "消費說明，例如：燙青菜 牛肉麵",
      "type": 3,
      "required": true
    },
    {
      "name": "payment_method",
      "description": "付款方式（預設：現金）",
      "type": 3,
      "required": false,
      "choices": [
        { "name": "現金", "value": "cash" },
        { "name": "信用卡", "value": "credit_card" },
        { "name": "悠遊卡", "value": "easy_card" },
        { "name": "銀行轉帳", "value": "bank_account" },
        { "name": "行動支付", "value": "prepaid_wallet" }
      ]
    }
  ]
}
```

## Changes from Previous Version

| Field | Before | After |
|-------|--------|-------|
| `description` (command) | "記錄一筆**現金**支出" | "記錄一筆支出" |
| `payment_method` option | absent | added, optional, 5 choices |

## Confirmation Message Format

```
✅ 記帳成功！
💰 金額：$<amount> [<payment_label>]
🏷️ 品項：<items>
📊 本月支出：$<current> / $<budget> (<pct>%)
```

Where `<payment_label>` is the Chinese label: 現金 / 信用卡 / 悠遊卡 / 銀行轉帳 / 行動支付.

## Registration

Command must be re-registered after deployment:

```bash
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npx tsx scripts/register-commands.ts
```
