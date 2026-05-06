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
  "bank_name": "玉山銀行",
  "payment_method": "credit_card",
  "wallet": "line_pay",
  "notification_text": "消費通知：玉山銀行信用卡消費 NT$380 消費說明：全家便利商店",
  "notified_at": "2026-05-05T14:32:00+08:00"
}
```

**Fields**:
| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | integer | ✓ | NTD amount (must be > 0) |
| `bank_name` | string | ✗ | Bank or card issuer name (null if unknown from this notification) |
| `payment_method` | string | ✓ | `credit_card` \| `prepaid_wallet` \| `easy_card` \| `bank_account` \| `cash` |
| `wallet` | string | ✗ | Mobile app used: `line_pay` \| `google_pay` \| null |
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

### Response 200 OK (multi-app notification merge)

Returned when a second notification for the same purchase arrives within the 3-minute dedup window. The existing transaction is enriched with any new non-null fields (`bank_name`, `wallet`).

```json
{
  "transaction_id": "550e8400-e29b-41d4-a716-446655440000",
  "discord_message_id": "1234567890123456789",
  "merged": true
}
```

Android treats 200 as success and deletes the entry from Room DB (no retry).

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

## Duplicate Detection & Multi-App Merge Logic (Server-side)

The same purchase may trigger multiple push notifications within ~3 minutes from different apps (e.g. 玉山銀行 + 玉山Wallet + LINE Pay official account). The server uses an **upsert** strategy rather than rejecting duplicates:

```
Query: transactions WHERE
  amount = request.amount
  AND created_at > NOW() - INTERVAL '3 minutes'
```

**Note**: `bank_name` and `payment_method` are intentionally excluded from the match condition — the same purchase generates notifications with different `bank_name` values across apps.

- **No match found** → `INSERT` new transaction → return `201 Created`
- **Match found** → `UPDATE` only NULL fields (`bank_name`, `wallet`) with incoming values → return `200 OK` with `"merged": true`

Android retry policy:
- `201` → success, delete from Room DB
- `200` → success (merged), delete from Room DB
- `4xx` (except `429`) → non-retryable, delete from Room DB
- `5xx` or network error → retry with exponential backoff

## Android Parser Ignore List

The following notification types must be detected and silently discarded by the Android parser (not forwarded to backend):

| Notification type | Detection keywords |
|---|---|
| EasyCard auto top-up | `自動加值`, `自動補值` |
| ATM cash withdrawal | `提款`, `提現`, `ATM` |
| Non-spending bank alerts | Balance queries, bill reminders, marketing |
