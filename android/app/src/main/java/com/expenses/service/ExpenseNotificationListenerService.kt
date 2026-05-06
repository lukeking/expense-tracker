package com.expenses.service

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.expenses.db.LocalDatabase
import com.expenses.db.PendingTransaction
import com.expenses.parser.NotificationParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.TimeUnit

class ExpenseNotificationListenerService : NotificationListenerService() {

    private val scope = CoroutineScope(Dispatchers.IO)

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val extras = sbn.notification.extras
        val title = extras.getString("android.title") ?: ""
        val text = extras.getCharSequence("android.text")?.toString() ?: ""

        val parsed = NotificationParser.parse(title, text) ?: return

        val notifiedAt = Instant.ofEpochMilli(sbn.postTime)
            .atZone(ZoneId.of("Asia/Taipei"))
            .format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

        val pending = PendingTransaction(
            amount = parsed.amount,
            bankName = parsed.bankName,
            paymentMethod = parsed.paymentMethod,
            wallet = parsed.wallet,
            notifiedAt = notifiedAt,
            rawText = "$title $text",
        )

        scope.launch {
            val db = LocalDatabase.getInstance(applicationContext)
            db.pendingTransactionDao().insert(pending)
            enqueueSyncWork()
        }
    }

    private fun enqueueSyncWork() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val workRequest = OneTimeWorkRequestBuilder<com.expenses.worker.TransactionSyncWorker>()
            .setConstraints(constraints)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()

        WorkManager.getInstance(applicationContext).enqueue(workRequest)
    }
}
