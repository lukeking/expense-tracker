# Contract: Discord Interactions Webhook

**Endpoint**: `POST /discord/interactions`  
**Auth**: Discord ed25519 signature verification (`X-Signature-Ed25519` + `X-Signature-Timestamp` headers)  
**Timeout**: Must respond within 3 seconds

---

## Signature Verification

All requests must pass ed25519 verification before processing:

```
verify(
  publicKey = env.DISCORD_PUBLIC_KEY,
  message   = X-Signature-Timestamp + body,
  signature = X-Signature-Ed25519
)
```

Return `401` immediately if verification fails.

---

## Interaction Types

### Type 1: PING (Discord health check)

**Request**:
```json
{ "type": 1 }
```

**Response** (200):
```json
{ "type": 1 }
```

---

### Type 2: APPLICATION_COMMAND (Slash commands)

#### `/expense <amount> <description>`

Record a cash expense manually.

**Request**:
```json
{
  "type": 2,
  "data": {
    "name": "expense",
    "options": [
      { "name": "amount",      "value": 150 },
      { "name": "description", "value": "燙青菜 牛肉麵" }
    ]
  },
  "id": "<interaction_id>",
  "token": "<interaction_token>"
}
```

**Immediate response** (200) — deferred:
```json
{ "type": 5 }
```

**Async follow-up** (PATCH `/webhooks/{application_id}/{token}/messages/@original`):
```json
{
  "content": "✅ 記帳成功！\n💰 金額：$150\n🏷️ 品項：燙青菜、牛肉麵\n📊 本月支出：$3,200 / $20,000 (16%)"
}
```

---

#### `/budget <amount>`

Update the monthly budget target.

**Request**:
```json
{
  "type": 2,
  "data": {
    "name": "budget",
    "options": [
      { "name": "amount", "value": 25000 }
    ]
  }
}
```

**Immediate response** (200):
```json
{
  "type": 4,
  "data": {
    "content": "✅ 月度預算已更新為 $25,000"
  }
}
```

---

#### `/summary [month]`

Show monthly spending summary.

**Request**:
```json
{
  "type": 2,
  "data": {
    "name": "summary",
    "options": [
      { "name": "month", "value": "2026-05" }
    ]
  }
}
```

**Immediate response** (200) — deferred:
```json
{ "type": 5 }
```

**Async follow-up**:
```json
{
  "content": "📊 2026年5月 支出摘要\n\n總支出：$8,450 / $20,000 (42%)\n\n🏷️ 標籤分佈：\n  food: $4,200 (50%)\n  transport: $1,800 (21%)\n  其他: $2,450 (29%)\n\n最近5筆：\n  2026-05-05 $150 燙青菜 牛肉麵\n  ..."
}
```

---

### Type 3: MESSAGE_COMPONENT (Button interactions)

Used for confirming ambiguous matches.

**Request**:
```json
{
  "type": 3,
  "data": {
    "custom_id": "confirm_match:{transaction_id}:{receipt_id}",
    "component_type": 2
  }
}
```

**Response** (200):
```json
{
  "type": 4,
  "data": {
    "content": "✅ 已確認匹配！發票：全家 $150 (2026-05-04)"
  }
}
```

**`custom_id` format**: `confirm_match:{uuid}:{uuid}` where first UUID is transaction, second is receipt.

---

## Notification Message Format (sent proactively by Android handler)

When Android POSTs a notification, the worker sends a Discord message:

```
🔔 消費通知
💳 台新銀行：$380
🕐 2026-05-05 14:32
📊 本月累計：$8,830 / $20,000 (44%)
⏳ 等待發票對齊...
```

Message ID is stored in `transactions.discord_message_id` for later PATCH editing when receipt is matched.

**After auto-match** (PATCH edit):
```
✅ 已對齊發票
💳 台新銀行：$380
🏪 全家便利商店 - 三重正義店
🧾 品項：拿鐵咖啡$65, 茶葉蛋$15, 御飯糰$35, 統一布丁$25...
🏷️ 自動標籤：food, convenience-store
📊 本月累計：$8,830 / $20,000 (44%)
```
