package com.expenses.db

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.Query

@Dao
interface PendingManualInputDao {
    @Insert
    suspend fun insert(input: PendingManualInput): Long

    @Query("SELECT * FROM pending_manual_inputs ORDER BY created_at ASC")
    suspend fun getAll(): List<PendingManualInput>

    @Query("DELETE FROM pending_manual_inputs WHERE id = :id")
    suspend fun delete(id: Long)

    @Query("UPDATE pending_manual_inputs SET retryCount = retryCount + 1 WHERE id = :id")
    suspend fun incrementRetry(id: Long)
}
