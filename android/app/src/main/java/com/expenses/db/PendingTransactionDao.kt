package com.expenses.db

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.Query

@Dao
interface PendingTransactionDao {
    @Insert
    suspend fun insert(transaction: PendingTransaction): Long

    @Query("SELECT * FROM pending_transactions ORDER BY id ASC LIMIT 1")
    suspend fun getOldest(): PendingTransaction?

    @Delete
    suspend fun delete(transaction: PendingTransaction)

    @Query("UPDATE pending_transactions SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetryCount(id: Long)
}
