package com.expenses.parser

data class ParsedNotification(
    val amount: Int,
    val bankName: String,
    val paymentMethod: String,
)

object NotificationParser {
    private val rules = listOf(
        // 台新銀行 credit card
        Rule(
            bankPattern = Regex("台新"),
            textPattern = Regex("""[Nn][Tt]\$?(\d+)|消費\s*NT\$?(\d+)|消費.*?(\d+)\s*元"""),
            bankName = "台新銀行",
            paymentMethod = "credit_card",
        ),
        // 國泰世華
        Rule(
            bankPattern = Regex("國泰"),
            textPattern = Regex("""NT\$?(\d+)|消費.*?(\d+)\s*元|刷卡.*?(\d+)"""),
            bankName = "國泰世華",
            paymentMethod = "credit_card",
        ),
        // 玉山銀行
        Rule(
            bankPattern = Regex("玉山"),
            textPattern = Regex("""NT\$?(\d+)|消費.*?(\d+)\s*元"""),
            bankName = "玉山銀行",
            paymentMethod = "credit_card",
        ),
        // 中信銀行
        Rule(
            bankPattern = Regex("中信|中國信託"),
            textPattern = Regex("""NT\$?(\d+)|消費.*?(\d+)\s*元"""),
            bankName = "中國信託",
            paymentMethod = "credit_card",
        ),
        // 富邦
        Rule(
            bankPattern = Regex("富邦"),
            textPattern = Regex("""NT\$?(\d+)|消費.*?(\d+)\s*元"""),
            bankName = "台北富邦",
            paymentMethod = "credit_card",
        ),
        // LINE Pay
        Rule(
            bankPattern = Regex("LINE Pay|LinePay"),
            textPattern = Regex("""(\d+)\s*元|NT\$?(\d+)|消費\s*(\d+)"""),
            bankName = "LINE Pay",
            paymentMethod = "mobile_pay",
        ),
        // 街口支付
        Rule(
            bankPattern = Regex("街口"),
            textPattern = Regex("""(\d+)\s*元|NT\$?(\d+)|付款\s*(\d+)"""),
            bankName = "街口支付",
            paymentMethod = "mobile_pay",
        ),
    )

    fun parse(title: String, text: String): ParsedNotification? {
        val combined = "$title $text"
        for (rule in rules) {
            if (!rule.bankPattern.containsMatchIn(combined)) continue
            val match = rule.textPattern.find(combined) ?: continue
            val amountStr = match.groupValues.drop(1).firstOrNull { it.isNotEmpty() } ?: continue
            val amount = amountStr.toIntOrNull() ?: continue
            if (amount <= 0) continue
            return ParsedNotification(amount, rule.bankName, rule.paymentMethod)
        }
        return null
    }

    private data class Rule(
        val bankPattern: Regex,
        val textPattern: Regex,
        val bankName: String,
        val paymentMethod: String,
    )
}
