# Contract: Android → CF Worker API

**Base URL**: `https://<worker>.workers.dev` (or custom domain)  
**Auth**: Static API key in `Authorization: Bearer <ANDROID_API_KEY>` header  
**Format**: JSON (Content-Type: application/json)

---

## POST /api/notification

Ingest a parsed bank notification from the Android app.

### Request

```http
POST /api/notification
Authorization: Bearer <ANDROID_API_KEY>
Content-Type: application/json
```

```json
{
  "amount": 380,
  "bank_name": "台新銀行",
  "payment_method": "credit_card",
  "notification_text": "消費通知：台新銀行信用卡消費 NT$380 消費說明：全家便利商店",
  "notified_at": "2026-05-05T14:32:00+08:00"
}
```

**Fields**:
| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | integer | ✓ | NTD amount (must be > 0) |
| `bank_name` | string | ✓ | Bank or payment provider name |
| `payment_method` | string | ✓ | `credit_card` or `mobile_pay` |
| `notification_text` | string | ✓ | Raw notification text (for logging) |
| `notified_at` | ISO 8601 | ✓ | Timestamp with timezone |

### Response 201 Created

```json
{
  "transaction_id": "550e8400-e29b-41d4-a716-446655440000",
  "discord_message_id": "1234567890123456789"
}
```

### Response 400 Bad Request

```json
{
  "error": "INVALID_PAYLOAD",
  "message": "amount must be a positive integer"
}
```

### Response 401 Unauthorized

```json
{
  "error": "UNAUTHORIZED"
}
```

### Response 409 Conflict (duplicate detection)

```json
{
  "error": "DUPLICATE_NOTIFICATION",
  "existing_transaction_id": "550e8400-e29b-41d4-a716-446655440000",
  "message": "A transaction with the same amount was recorded within the last 5 minutes"
}
```

---

## GET /api/health

Lightweight health check for Android WorkManager to verify connectivity before retry.

### Response 200

```json
{
  "status": "ok",
  "timestamp": "2026-05-05T06:32:00Z"
}
```

---

## Android Retry Policy

The Android app must implement exponential backoff:

```kotlin
val constraints = Constraints.Builder()
    .setRequiredNetworkType(NetworkType.CONNECTED)
    .build()

val retryPolicy = BackoffPolicy.EXPONENTIAL
val initialDelay = 30L   // seconds
val maxAttempts  = 10    // gives ~24h coverage
```

On `409 Conflict`, do NOT retry — log and discard.  
On `4xx` (except 429), do NOT retry — log error.  
On `5xx` or network error, retry with backoff.

---

## Duplicate Detection Logic (Server-side)

The server checks for a potential duplicate before creating a new transaction:

```
Query: transactions WHERE
  amount = request.amount
  AND payment_method = request.payment_method
  AND bank_name = request.bank_name
  AND created_at > NOW() - INTERVAL '5 minutes'
```

If a match is found → return `409 Conflict`.
