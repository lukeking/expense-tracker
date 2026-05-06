package com.expenses.network

import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

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

interface ExpenseApi {
    @POST("api/notification")
    suspend fun postNotification(@Body body: NotificationRequest): Response<NotificationResponse>

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
