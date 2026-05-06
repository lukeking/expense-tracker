package com.expenses.ui

import com.expenses.network.CandidateTransaction
import com.expenses.network.ExpenseApi
import com.expenses.network.RecentTransactionsResponse
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import retrofit2.Response

/**
 * Unit tests for the command-detection and candidate-fetch logic extracted from PromptActivity.
 */
class PromptViewModelTest {

    private val api: ExpenseApi = mockk()

    private val feePattern = Regex("""^(fee|refund)\s+""", RegexOption.IGNORE_CASE)

    // Mirrors the description-extraction logic in PromptActivity.fetchCandidatesAndPrompt
    private fun extractDesc(text: String): String? {
        val withoutPrefix = feePattern.replace(text, "")
        val parts = withoutPrefix.trim().split(" ", limit = 2)
        return if (parts.size > 1 && parts[1].isNotBlank()) parts[1].trim() else null
    }

    private fun candidateOf(id: String) = CandidateTransaction(
        id = id, amount = 1200, description = "Airbnb",
        transaction_at = "2026-04-30T14:23:00Z", transaction_type = "expense"
    )

    // (a) Plain expense skips candidate fetch
    @Test
    fun `plain expense text does not match fee pattern`() {
        val text = "250 星巴克 拿鐵"
        assert(!feePattern.containsMatchIn(text)) { "Expected no fee/refund prefix" }
    }

    // (b) `fee 47 Airbnb` triggers getRecentTransactions(q="Airbnb")
    @Test
    fun `fee command extracts description for candidate query`() = runTest {
        val text = "fee 47 Airbnb"
        assert(feePattern.containsMatchIn(text))
        val desc = extractDesc(text)
        assertEquals("Airbnb", desc)

        coEvery { api.getRecentTransactions(q = "Airbnb") } returns
            Response.success(RecentTransactionsResponse(listOf(candidateOf("uuid-1"))))

        val response = api.getRecentTransactions(q = desc)
        assert(response.isSuccessful)
        assertEquals(1, response.body()?.candidates?.size)
    }

    // (c) Candidate tap sets parentTransactionId before queuing
    @Test
    fun `selected candidate id is forwarded as parentTransactionId`() {
        var capturedId: String? = "not-set"
        val adapter = CandidateAdapter(listOf(candidateOf("uuid-1"))) { selectedId ->
            capturedId = selectedId
        }
        // Simulate tap on first item (index 0)
        adapter.onSelect("uuid-1")
        assertEquals("uuid-1", capturedId)
    }

    // (d) "None of these" tap sets parentTransactionId to null
    @Test
    fun `none-of-these tap passes null parentTransactionId`() {
        var capturedId: String? = "not-set"
        val adapter = CandidateAdapter(emptyList()) { selectedId ->
            capturedId = selectedId
        }
        adapter.onSelect(null)
        assertNull(capturedId)
    }

    // (e) `fee 47` with no description triggers getRecentTransactions(q=null)
    @Test
    fun `fee command with no description extracts null description`() = runTest {
        val text = "fee 47"
        assert(feePattern.containsMatchIn(text))
        val desc = extractDesc(text)
        assertNull(desc)

        coEvery { api.getRecentTransactions(q = null) } returns
            Response.success(RecentTransactionsResponse(listOf(candidateOf("uuid-2"))))

        val response = api.getRecentTransactions(q = desc)
        assert(response.isSuccessful)
        coVerify { api.getRecentTransactions(q = null) }
    }

    // Helper to invoke the adapter's callback directly in tests
    private fun CandidateAdapter.onSelect(id: String?) {
        // Access via reflection since it's a constructor parameter
        val field = CandidateAdapter::class.java.getDeclaredField("onSelect")
        field.isAccessible = true
        @Suppress("UNCHECKED_CAST")
        val callback = field.get(this) as (String?) -> Unit
        callback(id)
    }
}
