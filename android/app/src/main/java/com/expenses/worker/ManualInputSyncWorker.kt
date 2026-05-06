package com.expenses.worker

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.expenses.db.LocalDatabase
import com.expenses.network.ApiClient
import com.expenses.network.InputRequest

class ManualInputSyncWorker(
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
        val dao = db.pendingManualInputDao()
        val pending = dao.getAll()

        if (pending.isEmpty()) return Result.success()

        val api = ApiClient.create(baseUrl, apiKey)
        var anyRetry = false

        for (entry in pending) {
            if (entry.retryCount >= 5) {
                dao.delete(entry.id)
                continue
            }
            try {
                val response = api.postInput(
                    InputRequest(
                        text = entry.text,
                        parent_transaction_id = entry.parentTransactionId,
                    )
                )
                when {
                    response.isSuccessful -> dao.delete(entry.id)
                    response.code() == 409 -> dao.delete(entry.id) // duplicate — already recorded
                    response.code() == 422 -> dao.delete(entry.id) // parse error — unrecoverable
                    response.code() in 400..499 -> dao.delete(entry.id)
                    else -> {
                        dao.incrementRetry(entry.id)
                        anyRetry = true
                    }
                }
            } catch (e: Exception) {
                dao.incrementRetry(entry.id)
                anyRetry = true
            }
        }

        return if (anyRetry) Result.retry() else Result.success()
    }
}
