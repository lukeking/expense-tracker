# API Contract: Android Prompt Endpoints

**Feature**: 002-android-expense-prompt | **Date**: 2026-05-06
**Handler file**: `backend/src/handlers/android.ts`
**Auth**: All routes require `X-Api-Key: <ANDROID_API_KEY>` header (same as existing Android routes)

---

## POST /android/input

Submit a freeform text expense, fee, or refund command for NLP parsing and storage.

### Request

```http
POST /android/input
X-Api-Key: <ANDROID_API_KEY>
Content-Type: application/json

{
  "text": string,                    // Required. Raw user input, e.g. "250 星巴克 拿鐵"
  "parent_transaction_id": string    // Optional. UUID. Set for fee/refund commands.
}
```

**Field rules:**
- `text`: Non-empty. Max 500 characters.
- `parent_transaction_id`: Present and non-null only when the Android client has already resolved the candidate. Omit (or send `null`) for plain expenses or fee/refund with "None of these" selected.

### Command Detection (server-side)

The server inspects the `text` field prefix (case-insensitive, trimmed):

| Prefix | `transaction_type` set | Behaviour |
|--------|----------------------|-----------|
| `fee ` | `fee` | Requires non-null `parent_transaction_id` if candidate was selected; else null |
| `refund ` | `refund` | Same as above |
| anything else | `expense` | `parent_transaction_id` ignored |

### Response — 200 OK (success)

```json
{
  "success": true,
  "message": "Recorded NT$250 — 星巴克 拿鐵",
  "transaction_id": "uuid-v4",
  "budget_summary": {
    "total_spent": 8420,
    "monthly_budget": 20000,
    "remaining": 11580,
    "percentage": 42
  }
}
```

### Response — 422 Unprocessable Entity (parse failure)

Returned when Gemini cannot extract a valid amount from the input.

```json
{
  "success": false,
  "message": "無法解析金額，請確認格式如：250 星巴克"
}
```

**Android behaviour on 422**: Preserve input text, show error message inline. No queuing retry — the input is fundamentally invalid.

### Response — 409 Conflict (dedup)

Returned when the server detects a duplicate (same amount, same text, within 3 minutes).

```json
{
  "success": false,
  "message": "Duplicate detected — already recorded"
}
```

**Android behaviour on 409**: Treat as permanent failure. Delete from `PendingManualInput`, show toast. Do not retry.

### Response — 4xx/5xx (transient errors)

**Android behaviour**: Increment `retryCount` in Room, re-enqueue WorkManager with exponential backoff. Give up after 5 retries.

---

## GET /android/transactions/recent

Fetch recent transactions for the fee/refund candidate list.

### Request

```http
GET /android/transactions/recent?q=<description>&limit=20
X-Api-Key: <ANDROID_API_KEY>
```

**Query parameters:**

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | No | (empty) | Filter by description (case-insensitive substring match against item names and note) |
| `limit` | No | 20 | Maximum results. Clamped to 1–50. |

**Behaviour when `q` is empty or absent**: Returns the 20 most recent `expense`-type transactions (most recent first). Used for `fee` command with no description.

### Response — 200 OK

```json
{
  "candidates": [
    {
      "id": "uuid-v4",
      "amount": 1200,
      "description": "Airbnb",
      "transaction_at": "2026-04-30T14:23:00Z",
      "transaction_type": "expense"
    },
    {
      "id": "uuid-v4-2",
      "amount": 380,
      "description": "星巴克 拿鐵",
      "transaction_at": "2026-04-28T09:10:00Z",
      "transaction_type": "expense"
    }
  ]
}
```

**Candidate ordering**: Most recent `transaction_at` first.
**Candidate filtering**: Only `transaction_type = 'expense'` records are returned (cannot link a fee to another fee).
**Description construction**: `JOIN(items[].name, ' ')` if items exist, else `note`, else amount-only fallback.

### Response — 200 OK (no results)

```json
{
  "candidates": []
}
```

**Android behaviour on empty list**: Show "No matching transactions found. Save as unlinked?" prompt.

---

## Android UX Flow for fee/refund

```
User types: fee 47 Airbnb
                │
                ├─► App detects "fee " prefix (local, UI only)
                │
                ▼
GET /android/transactions/recent?q=Airbnb
                │
        ┌───────┴──────────┐
    candidates        no candidates
    returned          returned
        │                  │
        ▼                  ▼
  RecyclerView        Toast: "No matching
  shows candidates    transactions. Saving
  + "None of these"   as unlinked."
        │                  │
   user taps         POST /android/input
   candidate         { text, parent_transaction_id: null }
        │
        ▼
POST /android/input
{ text: "fee 47 Airbnb",
  parent_transaction_id: "<selected UUID>" }
```

---

## Existing Routes (unchanged)

| Route | Description |
|-------|-------------|
| `POST /android/notifications` | Auto-captured notification ingestion |

No changes to existing routes or authentication middleware.
