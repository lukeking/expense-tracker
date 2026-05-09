# Discord Command Contracts

**Feature**: 004-einvoice-csv-import | **Date**: 2026-05-09

---

## `/amend` — Correct a transaction's NTD amount

**Purpose**: Update the recorded amount on an existing expense transaction, primarily for correcting foreign-currency settlements where the initial estimated NTD amount differs from the final charged amount.

### Registration schema

```json
{
  "name": "amend",
  "description": "修正交易金額（例如：外幣結算後的實際金額）",
  "options": [
    {
      "name": "amount",
      "description": "修正後的金額 (NTD)",
      "type": 4,
      "required": true,
      "min_value": 1
    },
    {
      "name": "parent",
      "description": "要修正的交易關鍵字（例：Google）",
      "type": 3,
      "required": false
    }
  ]
}
```

### Interaction flow

```
User: /amend amount:1523 parent:Google

→ type:5 deferred ACK (immediate)

waitUntil:
  findParentCandidates('Google') → up to 5 expense transactions

  If candidates found:
    PATCH deferred message with buttons:
      - Button label: "NT$1,200 · Google Play · 04/18" (existing amount shown)
      - custom_id: "amend_select:1523:{txId}"
      - Plus: [🔍 重新搜尋] button → custom_id: "amend_retype:1523"

  If no candidates:
    PATCH deferred message: "'Google' 找不到符合的交易。"
    Buttons: [🔍 重新搜尋] custom_id:"amend_retype:1523"
             [取消] custom_id:"amend_cancel"
```

### Component interactions

#### `amend_select:{newAmount}:{txId}`
```
type: 7 (UPDATE_MESSAGE — replaces button message in place)

Action: UPDATE transactions SET amount = {newAmount} WHERE id = {txId}
Response content:
  "✅ 已修正：{description} NT${oldAmount} → NT${newAmount}
   {budget summary line}"
Components: []  (clear buttons)
```

#### `amend_retype:{newAmount}`
```
type: 9 (MODAL)

Modal title: "重新搜尋交易"
custom_id: "amend_modal:{newAmount}"
Component: text input
  label: "交易關鍵字"
  custom_id: "search_term"
  placeholder: "{previous search term if available}"
  required: true
```

#### Modal submit — `amend_modal:{newAmount}`
```
type: 6 (DEFERRED_UPDATE_MESSAGE — updates original message)

waitUntil:
  findParentCandidates(searchTerm) → repeat amend_select button flow
  If still no match: show "找不到符合的交易" with retype again
```

#### `amend_cancel`
```
type: 7 (UPDATE_MESSAGE)
Content: "已取消。"
Components: []
```

### custom_id encoding

| custom_id | Max length | Example |
|-----------|-----------|---------|
| `amend_select:{amount}:{uuid}` | 13+7+1+36 = 57 | `amend_select:1523:550e8400-e29b-41d4-a716-446655440000` |
| `amend_retype:{amount}` | 14+7 = 21 | `amend_retype:1523` |
| `amend_modal:{amount}` | 13+7 = 20 | `amend_modal:1523` |
| `amend_cancel` | 12 | `amend_cancel` |

All well within Discord's 100-character `custom_id` limit.

---

## `/import` — Import e-invoice CSV

**Purpose**: Upload a government e-invoice CSV export; the system parses, matches, and auto-creates transactions.

### Registration schema

```json
{
  "name": "import",
  "description": "匯入電子發票 CSV（從 einvoice.nat.gov.tw 下載）",
  "options": [
    {
      "name": "file",
      "description": "電子發票 CSV 檔案",
      "type": 11,
      "required": true
    }
  ]
}
```

### Interaction flow

```
User: /import file:<CSV attachment>

→ type:5 deferred ACK (immediate)

waitUntil:
  1. Fetch CSV bytes from interaction.data.resolved.attachments[fileId].url
  2. Detect encoding → decode to UTF-8 string
  3. Parse CSV rows → group by 發票號碼 → ParsedInvoice[]
  4. CREATE import_runs record (returns run_id)
  5. For each parsed invoice:
     a. Skip voided (已作廢) → increment skipped_voided_count
     b. Skip zero net_amount → increment skipped_zero_count
     c. Check UNIQUE(invoice_number) → skip duplicate → skipped_duplicate_count
     d. Primary match: find expense tx within ±2 days, exact net_amount
        → if found: UPDATE transaction (is_matched, invoice_number, seller_name, ...)
                    INSERT invoice (match_status: 'matched', matched_transaction_id)
     e. Secondary match: amount within ±5%, date within ±2 days
        → INSERT invoice (match_status: 'held_forex')
     f. No match: INSERT invoice (match_status: 'auto_created')
                  INSERT new transaction (expense, cash, AI tags)
  6. Post-import reconciliation: re-evaluate all held_forex invoices in DB
     → for each: exact match now? → link and set 'matched'
     → no match at all? → set 'auto_created', create transaction
  7. UPDATE import_runs with final counters
  8. PATCH Discord message with import summary
```

### Import summary Discord message format

```
📥 發票匯入完成 · {filename}

✅ 已比對：{matched_count} 筆
🆕 自動新增：{auto_created_count} 筆
⏭️ 已略過（重複）：{skipped_duplicate_count} 筆
🔄 外幣待確認：{held_forex_count} 筆（使用 /amend 修正金額後，下次匯入自動連結）
⚠️ 無法解析：{parse_failed_count} 筆

📊 本期無發票交易（可能為現金/海外）：
  · NT$180 · 05/01
  · NT$450 · 05/03
  [up to 5 listed; "+ N 筆" if more]
```

If `forex_resolved_count > 0` (reconciliation pass resolved some held invoices):
```
🔗 外幣已自動連結：{forex_resolved_count} 筆
```

If fully reconciled:
```
🎉 全部對齊！本期所有發票均已比對。
```

### Error responses (patched to deferred message)

| Condition | Message |
|-----------|---------|
| No file or fetch failed | "❌ 無法取得檔案，請重新上傳。" |
| File is not a CSV | "❌ 請上傳 CSV 格式的電子發票檔案。" |
| CSV has wrong headers | "❌ 發票格式不符，請確認為財政部電子發票平台匯出的 CSV。" |
| 0 rows after parsing | "❌ CSV 中沒有有效的發票資料。" |
