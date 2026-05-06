package com.expenses.network

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

data class NotificationRequest(
    val amount: Int,
    val bank_name: String?,
    val payment_method: String,
    val wallet: String?,
    val notification_text: String,
    val notified_at: String,
)

data class NotificationResponse(
    val transaction_id: String,
    val discord_message_id: String?,
)

data class HealthResponse(
    val status: String,
    val timestamp: String,
)

data class InputRequest(
    val text: String,
    val parent_transaction_id: String? = null,
)

data class BudgetSummary(
    val total_spent: Int,
    val monthly_budget: Int,
    val remaining: Int,
    val percentage: Int,
)

data class InputResponse(
    val success: Boolean,
    val message: String,
    val transaction_id: String?,
    val budget_summary: BudgetSummary?,
)

data class CandidateTransaction(
    val id: String,
    val amount: Int,
    val description: String,
    val transaction_at: String,
    val transaction_type: String,
)

data class RecentTransactionsResponse(
    val candidates: List<CandidateTransaction>,
)

interface ExpenseApi {
    @POST("api/notification")
    suspend fun postNotification(@Body body: NotificationRequest): Response<NotificationResponse>

    @POST("android/input")
    suspend fun postInput(@Body body: InputRequest): Response<InputResponse>

    @GET("android/transactions/recent")
    suspend fun getRecentTransactions(
        @Query("q") q: String? = null,
        @Query("limit") limit: Int = 20,
    ): Response<RecentTransactionsResponse>

    @GET("api/health")
    suspend fun getHealth(): Response<HealthResponse>
}

object ApiClient {
    fun create(baseUrl: String, apiKey: String): ExpenseApi {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        }

        val httpClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val request = chain.request().newBuilder()
                    .header("Authorization", "Bearer $apiKey")
                    .build()
                chain.proceed(request)
            }
            .addInterceptor(logging)
            .build()

        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(httpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(ExpenseApi::class.java)
    }
}
