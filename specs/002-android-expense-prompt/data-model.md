# Data Model: Android Expense Prompt

**Feature**: 002-android-expense-prompt | **Date**: 2026-05-06

---

## New Android Entity: PendingManualInput (Room)

Stores raw text inputs that have been submitted by the user but not yet successfully synced to the backend. Separate from `PendingTransaction` because manual inputs carry raw text (server does the parsing), whereas `PendingTransaction` carries already-parsed fields from notification interception.

### Room Entity

```kotlin
@Entity(tableName = "pending_manual_inputs")
data class PendingManualInput(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val text: String,                         // Raw user input, e.g. "250 星巴克 拿鐵" or "fee 47 Airbnb"
    val parentTransactionId: String? = null,  // UUID — resolved before queuing for fee/refund
    val createdAt: Long = System.currentTimeMillis(),
    val retryCount: Int = 0
)
```

### DAO

```kotlin
@Dao
interface PendingManualInputDao {
    @Insert
    suspend fun insert(input: PendingManualInput): Long

    @Query("SELECT * FROM pending_manual_inputs ORDER BY created_at ASC")
    suspend fun getAll(): List<PendingManualInput>

    @Query("DELETE FROM pending_manual_inputs WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE pending_manual_inputs SET retry_count = retry_count + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)
}
```

### LocalDatabase Change

Add `PendingManualInput::class` to the `@Database` entities list and bump the schema version.

```kotlin
@Database(
    entities = [PendingTransaction::class, PendingManualInput::class],
    version = 2,
    exportSchema = false
)
abstract class LocalDatabase : RoomDatabase() {
    abstract fun pendingTransactionDao(): PendingTransactionDao
    abstract fun pendingManualInputDao(): PendingManualInputDao
}
```

**Migration**: Add a simple migration from version 1 → 2 that creates the `pending_manual_inputs` table.

---

## Field Semantics

| Field | Type | Notes |
|-------|------|-------|
| `id` | `Long` (autoincrement) | Local-only primary key |
| `text` | `String NOT NULL` | Full raw input as typed by user |
| `parentTransactionId` | `String?` (UUID) | Set before insert for `fee`/`refund`; null for plain expenses |
| `createdAt` | `Long` (epoch ms) | Used for ordering and retry staleness checks |
| `retryCount` | `Int DEFAULT 0` | Incremented on each failed sync attempt; worker gives up after 5 retries |

---

## Backend Types (additions to types.ts)

```typescript
// Response from POST /android/input
export interface InputResponse {
  success: boolean;
  message: string;           // Human-readable confirmation or error
  transaction_id?: string;   // UUID if successfully stored
  budget_summary?: BudgetSummary;
}

export interface BudgetSummary {
  total_spent: number;
  monthly_budget: number;
  remaining: number;
  percentage: number;        // 0–100
}

// Item returned by GET /android/transactions/recent
export interface CandidateTransaction {
  id: string;               // UUID
  amount: number;
  description: string;      // Joined item names or note
  transaction_at: string;   // ISO 8601
  transaction_type: TransactionType;
}
```

---

## Existing Schema: No Changes Required

The `transactions` table already has `parent_transaction_id UUID` and `transaction_type TEXT` from the data-model work in feature 001. No new Supabase migrations needed for this feature.

---

## State Transitions (PendingManualInput)

```
User submits text
        │
        ▼
[QUEUED] PendingManualInput inserted (retryCount=0)
        │
        ▼
ManualInputSyncWorker picks up
        │
   ┌────┴──────────────────────────┐
   │ POST /android/input           │
   │                               │
success (200)               error (network/5xx)
   │                               │
   ▼                               ▼
[DONE] deleted from DB     retryCount++ (exponential backoff)
                                   │
                              retryCount > 5
                                   │
                                   ▼
                           [DEAD] deleted; user notified
                           (optional: notification)

409 Conflict (parse error) → treat as permanent failure:
  delete from DB, surface error to user via notification
```
