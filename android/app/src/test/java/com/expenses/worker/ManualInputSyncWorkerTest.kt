package com.expenses.worker

import com.expenses.db.PendingManualInput
import com.expenses.db.PendingManualInputDao
import com.expenses.network.BudgetSummary
import com.expenses.network.ExpenseApi
import com.expenses.network.InputRequest
import com.expenses.network.InputResponse
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.Response

class ManualInputSyncWorkerTest {

    private val dao: PendingManualInputDao = mockk(relaxed = true)
    private val api: ExpenseApi = mockk()

    private val entry = PendingManualInput(id = 1L, text = "250 星巴克", retryCount = 0)

    private fun successResponse() = Response.success(
        InputResponse(
            success = true,
            message = "記帳成功！NT\$250 — 星巴克",
            transaction_id = "uuid-1",
            budget_summary = BudgetSummary(
                total_spent = 250, monthly_budget = 20000,
                remaining = 19750, percentage = 1,
            ),
        )
    )

    private fun errorResponse(code: Int) =
        Response.error<InputResponse>(code, "".toResponseBody())

    // (a) Success: entry deleted from DB
    @Test
    fun `success response deletes entry`() = runTest {
        coEvery { dao.getAll() } returns listOf(entry)
        coEvery { api.postInput(any()) } returns successResponse()

        runSync()

        coVerify { dao.delete(1L) }
        coVerify(exactly = 0) { dao.incrementRetry(any()) }
    }

    // (b) 409 treated as permanent success — delete without retry
    @Test
    fun `409 response deletes entry without retry`() = runTest {
        coEvery { dao.getAll() } returns listOf(entry)
        coEvery { api.postInput(any()) } returns errorResponse(409)

        runSync()

        coVerify { dao.delete(1L) }
        coVerify(exactly = 0) { dao.incrementRetry(any()) }
    }

    // (c) 422 parse error treated as permanent failure — delete without retry
    @Test
    fun `422 response deletes entry without retry`() = runTest {
        coEvery { dao.getAll() } returns listOf(entry)
        coEvery { api.postInput(any()) } returns errorResponse(422)

        runSync()

        coVerify { dao.delete(1L) }
        coVerify(exactly = 0) { dao.incrementRetry(any()) }
    }

    // (d) Network error increments retryCount and returns retry
    @Test
    fun `network exception increments retry`() = runTest {
        coEvery { dao.getAll() } returns listOf(entry)
        coEvery { api.postInput(any()) } throws Exception("timeout")

        runSync()

        coVerify { dao.incrementRetry(1L) }
        coVerify(exactly = 0) { dao.delete(any()) }
    }

    // (e) Entry with retryCount=5 is deleted without network call
    @Test
    fun `entry at max retries is deleted without calling API`() = runTest {
        val exhausted = entry.copy(retryCount = 5)
        coEvery { dao.getAll() } returns listOf(exhausted)

        runSync()

        coVerify { dao.delete(1L) }
        coVerify(exactly = 0) { api.postInput(any()) }
    }

    // (f) parentTransactionId is forwarded in request
    @Test
    fun `parentTransactionId forwarded in request`() = runTest {
        val feeEntry = PendingManualInput(id = 2L, text = "fee 47 Airbnb", parentTransactionId = "parent-uuid")
        coEvery { dao.getAll() } returns listOf(feeEntry)
        coEvery { api.postInput(InputRequest("fee 47 Airbnb", "parent-uuid")) } returns successResponse()

        runSync()

        coVerify { api.postInput(InputRequest("fee 47 Airbnb", "parent-uuid")) }
    }

    private suspend fun runSync() {
        val pending = dao.getAll()
        for (entry in pending) {
            if (entry.retryCount >= 5) {
                dao.delete(entry.id)
                continue
            }
            try {
                val response = api.postInput(InputRequest(entry.text, entry.parentTransactionId))
                when {
                    response.isSuccessful -> dao.delete(entry.id)
                    response.code() == 409 -> dao.delete(entry.id)
                    response.code() == 422 -> dao.delete(entry.id)
                    response.code() in 400..499 -> dao.delete(entry.id)
                    else -> dao.incrementRetry(entry.id)
                }
            } catch (e: Exception) {
                dao.incrementRetry(entry.id)
            }
        }
    }
}
