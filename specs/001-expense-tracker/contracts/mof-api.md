# Contract: 財政部電子發票平台 API Integration

**Platform**: einvoice.nat.gov.tw  
**Carrier Type**: B2 (手機條碼 / Mobile Barcode)  
**Trigger**: CF Workers Cron Trigger — daily at 10:00 Taiwan time (`0 2 * * *` UTC)

---

## Authentication

The integration requires three credentials (stored as CF Workers secrets):

| Secret Name | Description |
|---|---|
| `MOF_CARRIER_ID` | Mobile barcode ID (e.g. `/AB12CD3`) |
| `MOF_VERIFICATION_CODE` | 4-char verification code set on MOF platform |
| `MOF_API_KEY` | Application API key from MOF developer registration |

---

## API Endpoint

**Query carrier invoices by date range**:

```
GET https://einvoice.nat.gov.tw/PB2CAPIVAN/CarrierInvChk
```

**Query parameters**:

| Param | Value | Description |
|---|---|---|
| `version` | `0.5` | API version |
| `type` | `B2` | Mobile barcode carrier type |
| `carrierId2` | `{MOF_CARRIER_ID}` | URL-encoded barcode |
| `cardEncrypt` | `{MOF_VERIFICATION_CODE}` | Verification code |
| `appID` | `{MOF_API_KEY}` | Application API key |
| `action` | `carrierInvChk` | Action name |
| `startDate` | `YYYY/MM/DD` | Query start date |
| `endDate` | `YYYY/MM/DD` | Query end date |
| `onlyWinningInv` | `N` | Include all invoices |

**Example request** (TypeScript):
```typescript
const params = new URLSearchParams({
  version:       '0.5',
  type:          'B2',
  carrierId2:    encodeURIComponent(env.MOF_CARRIER_ID),
  cardEncrypt:   env.MOF_VERIFICATION_CODE,
  appID:         env.MOF_API_KEY,
  action:        'carrierInvChk',
  startDate:     yesterday.toFormat('yyyy/MM/dd'),
  endDate:       yesterday.toFormat('yyyy/MM/dd'),
  onlyWinningInv:'N',
});

const resp = await fetch(`https://einvoice.nat.gov.tw/PB2CAPIVAN/CarrierInvChk?${params}`);
```

---

## Response Format

```json
{
  "code": 200,
  "msg": "OK",
  "details": [
    {
      "rowNum": 1,
      "invNum": "AB12345678",
      "cardType": "3J0001",
      "cardNo": "/AB12CD3",
      "sellerName": "全家便利商店",
      "invDate": "112/05/04",
      "invStatus": "已確認",
      "invPeriod": "11205",
      "sellerBan": "22099131",
      "sellerAddress": "台北市...",
      "amount": "380",
      "details": [
        {
          "rowNum": 1,
          "description": "拿鐵咖啡",
          "quantity": "1",
          "unitPrice": "65",
          "amount": "65"
        }
      ]
    }
  ]
}
```

**Date format note**: ROC calendar (e.g. `112/05/04` = 2023/05/04). Must convert: `ROC year + 1911 = CE year`.

---

## Cron Handler Workflow

```typescript
// src/handlers/mof-sync.ts
export async function handleMofSync(env: Env) {
  const yesterday = getYesterdayTaiwanTime();

  // 1. Fetch invoices from MOF API
  const invoices = await fetchMofInvoices(env, yesterday);

  // 2. Upsert into receipts table (conflict on invoice_number = skip)
  await upsertReceipts(env.supabase, invoices);

  // 3. Run matching algorithm
  await runMatchingAlgorithm(env);
}
```

---

## Error Handling

| MOF `code` | Meaning | Action |
|---|---|---|
| 200 | Success | Process normally |
| 401 | Auth failure | Alert via Discord, stop |
| 404 | No invoices in range | Normal (no-op) |
| 429 | Rate limit | Retry tomorrow |
| 500 | MOF server error | Log, retry tomorrow |

On persistent auth failure (code 401), send Discord alert:
```
⚠️ 財政部 API 認證失敗，請重新設定驗證碼。
```
