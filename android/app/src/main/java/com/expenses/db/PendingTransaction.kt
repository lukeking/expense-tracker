package com.expenses.db

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_transactions")
data class PendingTransaction(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val amount: Int,
    val bankName: String,
    val paymentMethod: String,
    val wallet: String? = null,
    val notifiedAt: String,
    val rawText: String,
    val retryCount: Int = 0,
)
