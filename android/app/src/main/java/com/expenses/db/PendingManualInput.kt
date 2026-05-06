package com.expenses.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_manual_inputs")
data class PendingManualInput(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val text: String,
    val parentTransactionId: String? = null,
    val createdAt: Long = System.currentTimeMillis(),
    val retryCount: Int = 0,
)
