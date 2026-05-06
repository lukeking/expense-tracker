package com.expenses.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.expenses.R
import com.expenses.network.CandidateTransaction
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

class CandidateAdapter(
    private val candidates: List<CandidateTransaction>,
    private val onSelect: (transactionId: String?) -> Unit,
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private val dateFormatter = DateTimeFormatter.ofPattern("MM/dd")

    companion object {
        private const val VIEW_TYPE_CANDIDATE = 0
        private const val VIEW_TYPE_NONE = 1
    }

    override fun getItemCount(): Int = candidates.size + 1 // +1 for "None of these" footer

    override fun getItemViewType(position: Int): Int =
        if (position < candidates.size) VIEW_TYPE_CANDIDATE else VIEW_TYPE_NONE

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        return if (viewType == VIEW_TYPE_CANDIDATE) {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_candidate, parent, false)
            CandidateViewHolder(view)
        } else {
            val view = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_candidate, parent, false)
            NoneViewHolder(view)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        if (holder is CandidateViewHolder) {
            val candidate = candidates[position]
            holder.bind(candidate)
            holder.itemView.setOnClickListener { onSelect(candidate.id) }
        } else if (holder is NoneViewHolder) {
            holder.bind()
            holder.itemView.setOnClickListener { onSelect(null) }
        }
    }

    inner class CandidateViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val tvDate: TextView = view.findViewById(R.id.tvDate)
        private val tvDescription: TextView = view.findViewById(R.id.tvDescription)
        private val tvAmount: TextView = view.findViewById(R.id.tvAmount)

        fun bind(candidate: CandidateTransaction) {
            tvDate.text = try {
                ZonedDateTime.parse(candidate.transaction_at).format(dateFormatter)
            } catch (e: Exception) {
                ""
            }
            tvDescription.text = candidate.description
            tvAmount.text = "NT$${candidate.amount}"
        }
    }

    inner class NoneViewHolder(view: View) : RecyclerView.ViewHolder(view) {
        private val tvDate: TextView = view.findViewById(R.id.tvDate)
        private val tvDescription: TextView = view.findViewById(R.id.tvDescription)
        private val tvAmount: TextView = view.findViewById(R.id.tvAmount)

        fun bind() {
            tvDate.text = ""
            tvDescription.text = "None of these / record without link"
            tvAmount.text = ""
        }
    }
}
