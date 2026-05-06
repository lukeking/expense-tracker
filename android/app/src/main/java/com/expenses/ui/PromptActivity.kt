package com.expenses.ui

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import com.expenses.R
import com.expenses.db.LocalDatabase
import com.expenses.db.PendingManualInput
import com.expenses.network.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit
import com.expenses.worker.ManualInputSyncWorker

class PromptActivity : AppCompatActivity() {

    private lateinit var etInput: EditText
    private lateinit var btnSubmit: Button
    private lateinit var tvStatus: TextView
    private lateinit var tvCandidateLabel: TextView
    private lateinit var rvCandidates: RecyclerView

    private val feePattern = Regex("""^(fee|refund)\s+""", RegexOption.IGNORE_CASE)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_prompt)

        etInput = findViewById(R.id.etInput)
        btnSubmit = findViewById(R.id.btnSubmit)
        tvStatus = findViewById(R.id.tvStatus)
        tvCandidateLabel = findViewById(R.id.tvCandidateLabel)
        rvCandidates = findViewById(R.id.rvCandidates)
        rvCandidates.layoutManager = LinearLayoutManager(this)

        btnSubmit.setOnClickListener { onSubmit() }
    }

    private fun onSubmit() {
        val text = etInput.text.toString().trim()
        if (text.isEmpty()) {
            showStatus("Please enter an expense description.")
            return
        }

        btnSubmit.isEnabled = false
        hideCandidates()

        if (feePattern.containsMatchIn(text)) {
            fetchCandidatesAndPrompt(text)
        } else {
            enqueueAndSync(text, parentTransactionId = null)
        }
    }

    private fun fetchCandidatesAndPrompt(text: String) {
        val baseUrl = getString(resources.getIdentifier("worker_base_url", "string", packageName))
        val apiKey = getString(resources.getIdentifier("android_api_key", "string", packageName))
        val api = ApiClient.create(baseUrl, apiKey)

        // Extract description after "fee|refund <amount> " or "fee|refund "
        val withoutPrefix = feePattern.replace(text, "")
        val descPart = withoutPrefix.substringAfter(" ", "").trim().ifEmpty { null }
        // If the whole remaining text after prefix is just the amount, descPart is null → return all recent

        lifecycleScope.launch {
            showStatus("Fetching recent transactions…")
            try {
                val response = withContext(Dispatchers.IO) {
                    api.getRecentTransactions(q = descPart)
                }
                if (response.isSuccessful) {
                    val candidates = response.body()?.candidates ?: emptyList()
                    if (candidates.isEmpty()) {
                        showStatus("No matching transactions found. Recording as unlinked.")
                        enqueueAndSync(text, parentTransactionId = null)
                    } else {
                        showCandidates(text, candidates)
                    }
                } else {
                    enqueueAndSync(text, parentTransactionId = null)
                }
            } catch (e: Exception) {
                enqueueAndSync(text, parentTransactionId = null)
            }
        }
    }

    private fun showCandidates(
        originalText: String,
        candidates: List<com.expenses.network.CandidateTransaction>,
    ) {
        tvCandidateLabel.visibility = View.VISIBLE
        rvCandidates.visibility = View.VISIBLE
        tvStatus.visibility = View.GONE
        btnSubmit.isEnabled = true

        rvCandidates.adapter = CandidateAdapter(candidates) { selectedId ->
            hideCandidates()
            enqueueAndSync(originalText, parentTransactionId = selectedId)
        }
    }

    private fun hideCandidates() {
        tvCandidateLabel.visibility = View.GONE
        rvCandidates.visibility = View.GONE
    }

    private fun enqueueAndSync(text: String, parentTransactionId: String?) {
        lifecycleScope.launch {
            withContext(Dispatchers.IO) {
                val db = LocalDatabase.getInstance(applicationContext)
                db.pendingManualInputDao().insert(
                    PendingManualInput(
                        text = text,
                        parentTransactionId = parentTransactionId,
                    )
                )
            }

            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = OneTimeWorkRequestBuilder<ManualInputSyncWorker>()
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()

            WorkManager.getInstance(applicationContext).enqueue(workRequest)

            WorkManager.getInstance(applicationContext)
                .getWorkInfoByIdLiveData(workRequest.id)
                .observe(this@PromptActivity) { info ->
                    if (info == null) return@observe
                    when (info.state) {
                        WorkInfo.State.SUCCEEDED -> {
                            showStatus("Recorded successfully.")
                            etInput.setText("")
                            etInput.requestFocus()
                            btnSubmit.isEnabled = true
                        }
                        WorkInfo.State.FAILED -> {
                            showStatus("Failed to record. Please try again.")
                            btnSubmit.isEnabled = true
                        }
                        WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING -> {
                            showStatus("Saving…")
                        }
                        else -> Unit
                    }
                }

            // If no network: show offline message immediately
            if (!isNetworkAvailable()) {
                showStatus("Saved offline — will sync when connected.")
                etInput.setText("")
                etInput.requestFocus()
                btnSubmit.isEnabled = true
            }
        }
    }

    private fun isNetworkAvailable(): Boolean {
        val cm = getSystemService(CONNECTIVITY_SERVICE) as android.net.ConnectivityManager
        val network = cm.activeNetwork ?: return false
        val caps = cm.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun showStatus(message: String) {
        tvStatus.text = message
        tvStatus.visibility = View.VISIBLE
    }
}
