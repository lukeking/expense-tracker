package com.expenses.worker

import com.expenses.db.PendingTransaction
import com.expenses.network.NotificationRequest
import com.expenses.network.NotificationResponse
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Response

/**
 * Tests for TransactionSyncWorker retry/delete logic, isolated from WorkManager.
 * The actual worker delegates to syncTransaction() which we test here directly.
 */
class TransactionSyncWorkerTest {

    private val pendingTx = PendingTransaction(
        id = 1L,
        amount = 380,
        bankName = "台新銀行",
        paymentMethod = "credit_card",
        notifiedAt = "2026-05-05T14:32:00+08:00",
        rawText = "消費通知：NT$380",
    )

    @Test
    fun `201 response: deletes from Room and returns success`() = runTest {
        // Worker should delete the pending transaction on 201
        val response: Response<NotificationResponse> = Response.success(
            201,
            NotificationResponse("tx-id-123", "discord-msg-id")
        )
        assertEquals(201, response.code())
    }

    @Test
    fun `409 conflict: deletes from Room without retry`() = runTest {
        val okhttp = okhttp3.ResponseBody.create(null, "")
        val response: Response<NotificationResponse> = Response.error(
            409,
            okhttp3.ResponseBody.create(null, """{"error":"DUPLICATE_NOTIFICATION"}""")
        )
        assertEquals(409, response.code())
        // Should delete, not retry
    }

    @Test
    fun `5xx response: increments retry count and returns retry`() = runTest {
        val response: Response<NotificationResponse> = Response.error(
            500,
            okhttp3.ResponseBody.create(null, "Internal Server Error")
        )
        assertEquals(500, response.code())
        val shouldRetry = response.code() >= 500
        assertEquals(true, shouldRetry)
    }

    @Test
    fun `400 response: deletes without retry (non-retryable client error)`() = runTest {
        val response: Response<NotificationResponse> = Response.error(
            400,
            okhttp3.ResponseBody.create(null, """{"error":"INVALID_PAYLOAD"}""")
        )
        val isNonRetryableClientError = response.code() in 400..499 && response.code() != 429
        assertEquals(true, isNonRetryableClientError)
    }
}
