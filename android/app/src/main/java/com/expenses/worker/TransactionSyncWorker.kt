package com.expenses.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.expenses.db.LocalDatabase
import com.expenses.network.ApiClient
import com.expenses.network.NotificationRequest

class TransactionSyncWorker(
    context: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(context, workerParams) {

    override suspend fun doWork(): Result {
        val baseUrl = applicationContext.getString(
            applicationContext.resources.getIdentifier("worker_base_url", "string", applicationContext.packageName)
        )
        val apiKey = applicationContext.getString(
            applicationContext.resources.getIdentifier("android_api_key", "string", applicationContext.packageName)
        )

        val db = LocalDatabase.getInstance(applicationContext)
        val dao = db.pendingTransactionDao()
        val pending = dao.getOldest() ?: return Result.success()

        val api = ApiClient.create(baseUrl, apiKey)

        return try {
            val response = api.postNotification(
                NotificationRequest(
                    amount = pending.amount,
                    bank_name = pending.bankName.ifEmpty { null },
                    payment_method = pending.paymentMethod,
                    wallet = pending.wallet,
                    notification_text = pending.rawText,
                    notified_at = pending.notifiedAt,
                )
            )

            when {
                response.code() == 201 || response.code() == 200 -> {
                    // 201 = new transaction created; 200 = merged into existing
                    dao.delete(pending)
                    Result.success()
                }
                response.code() in 400..499 -> {
                    // Non-retryable client error
                    dao.delete(pending)
                    Result.failure()
                }
                else -> {
                    // 5xx or network error — retry with exponential backoff
                    dao.incrementRetryCount(pending.id)
                    Result.retry()
                }
            }
        } catch (e: Exception) {
            dao.incrementRetryCount(pending.id)
            Result.retry()
        }
    }
}
