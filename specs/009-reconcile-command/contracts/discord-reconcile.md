# Contract: Discord /reconcile Command & Component Interactions

**Branch**: `009-reconcile-command` | **Date**: 2026-05-10

---

## 1. Slash Command: `/reconcile`

### Registration (scripts/register-commands.ts)

```json
{
  "name": "reconcile",
  "description": "重新比對所有待確認發票（外幣/模糊）"
}
```

No options or subcommands. Zero required fields — single no-args invocation.

### Interaction Flow

**Incoming** (Discord → Worker): `POST /discord/interactions`
```json
{
  "type": 2,
  "data": { "name": "reconcile" },
  "token": "<interaction_token>",
  "id": "<interaction_id>"
}
```

**Immediate response** (Worker → Discord): Deferred acknowledgment
```json
{ "type": 5 }
```

**Follow-up** (Worker → Discord via PATCH, inside `ctx.waitUntil`):
```
PATCH https://discord.com/api/v10/webhooks/{APPLICATION_ID}/{token}/messages/@original
Body: { "content": "<reconciliation_summary>" }
```

**Summary message format** (no held invoices):
```
🔄 比對完成 — 無待確認發票
```

**Summary message format** (with resolutions):
```
🔄 比對完成

🔗 外幣已連結：N 筆
🆕 外幣自動新增：N 筆
🔗 模糊已自動連結：N 筆（候選數降為 1）
🆕 模糊自動新增：N 筆
⚠️ 衝突跳過：N 筆

⏳ 仍待確認（外幣）：N 筆
❓ 仍待手動確認（模糊）：N 筆
```

**If ambiguous invoices remain** (2+ candidates): After the summary message, the bot
sends the first ambiguous invoice prompt as a separate follow-up message (see §2).

---

## 2. Sequential Ambiguous Invoice Prompt

Sent as a follow-up channel message (not an edit of the deferred response) for each
`ambiguous` invoice that still has 2+ candidates.

**Format:**
```
❓ 模糊發票 — 請選擇正確交易：
🏪 {seller_name}  NT${net_amount}  ({invoice_date})

候選交易：
```

**Components** (action rows with buttons):

Action row 1 — candidate transaction buttons (up to 5):
```json
{
  "type": 1,
  "components": [
    {
      "type": 2,
      "style": 1,
      "label": "NT${amount} · {item_name_or_note} ({MM/DD HH:mm})",
      "custom_id": "reconcile_link:{invoiceId}:{transactionId}"
    }
  ]
}
```

Action row 2 — skip button:
```json
{
  "type": 1,
  "components": [
    {
      "type": 2,
      "style": 2,
      "label": "跳過（保留待確認）",
      "custom_id": "reconcile_skip:{invoiceId}"
    }
  ]
}
```

**Candidate label format**: `NT${amount} · {description} ({MM/DD HH:mm})`
- `description` = `items[0].name ?? note ?? "NT${amount}"`
- Date formatted as UTC+8

**Candidate count cap**: Max 5 buttons (most-recently-created first). If >5 candidates
exist (extraordinary edge case), only the 5 most recent are shown.

---

## 3. Component Interaction: `reconcile_link:{invoiceId}:{transactionId}`

**Incoming** (Discord → Worker): `POST /discord/interactions`
```json
{
  "type": 3,
  "data": {
    "custom_id": "reconcile_link:{invoiceId}:{transactionId}",
    "component_type": 2
  },
  "token": "<interaction_token>"
}
```

**Success response** — update the message in place + advance to next invoice:
```json
{
  "type": 7,
  "data": {
    "content": "✅ 已連結：{seller_name} NT${net_amount} → {transaction_description}",
    "components": []
  }
}
```
Then send next ambiguous invoice prompt as a new follow-up message (if any remain).

**Collision error response** — target transaction already matched:
```json
{
  "type": 7,
  "data": {
    "content": "⚠️ 此交易已連結其他發票，請選擇其他候選：\n🏪 {seller_name}  NT${net_amount}\n\n候選交易：",
    "components": [/* refreshed candidate buttons excluding the conflicting tx */]
  }
}
```

**No remaining candidates** (all now matched): Auto-create response
```json
{
  "type": 7,
  "data": {
    "content": "⚠️ 所有候選交易已被其他發票連結。已自動新增一筆支出：NT${net_amount} · {seller_name}",
    "components": []
  }
}
```
Then advance to next ambiguous invoice.

---

## 4. Component Interaction: `reconcile_skip:{invoiceId}`

**Incoming** (Discord → Worker): `POST /discord/interactions`
```json
{
  "type": 3,
  "data": {
    "custom_id": "reconcile_skip:{invoiceId}",
    "component_type": 2
  }
}
```

**Response** — update the message in place:
```json
{
  "type": 7,
  "data": {
    "content": "⏭️ 已跳過，保留待確認。",
    "components": []
  }
}
```
Then send next ambiguous invoice prompt as a new follow-up message (if any remain).
If no more ambiguous invoices, send:
```json
{
  "type": 7,
  "data": {
    "content": "⏭️ 已跳過，保留待確認。（無更多待確認發票）",
    "components": []
  }
}
```

---

## 5. Custom ID Reference

| custom_id pattern | Max length | Usage |
|---|---|---|
| `reconcile_link:{36-char UUID}:{36-char UUID}` | 87 chars | Link ambiguous invoice to chosen transaction |
| `reconcile_skip:{36-char UUID}` | 51 chars | Skip ambiguous invoice |

Both are within Discord's 100-character `custom_id` limit.

---

## 6. Error Handling

| Condition | Response |
|---|---|
| `invoiceId` not found in DB | `type: 4`, content: `❌ 發票不存在或已處理` |
| `transactionId` not found or wrong type | `type: 4`, content: `❌ 交易不存在` |
| `transactionId` already matched (collision) | `type: 7` with refreshed buttons (see §3) |
| Supabase error during reconciliation pass | Follow-up: `❌ 比對失敗，請稍後再試。` |
| Supabase error during link | `type: 4`, content: `❌ 連結失敗，請稍後再試。` |
