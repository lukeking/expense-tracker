package com.expenses.parser

data class ParsedNotification(
    val amount: Int,
    val bankName: String,
    val paymentMethod: String,
    val wallet: String? = null,
)

object NotificationParser {

    private val ignorePatterns = listOf(
        Regex("自動加值|自動補值"),   // EasyCard auto top-up
        Regex("提款|提現|ATM"),       // ATM cash withdrawal
    )

    private val walletPatterns = mapOf(
        "line_pay" to Regex("LINE Pay|LinePay", RegexOption.IGNORE_CASE),
        "google_pay" to Regex("Google Pay|GooglePay", RegexOption.IGNORE_CASE),
    )

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
        // 玉山銀行 / 玉山Wallet
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
        // LINE Pay — wallet: line_pay; payment_method determined by context (credit_card by default)
        Rule(
            bankPattern = Regex("LINE Pay|LinePay", RegexOption.IGNORE_CASE),
            textPattern = Regex("""(\d+)\s*元|NT\$?(\d+)|消費\s*(\d+)"""),
            bankName = "LINE Pay",
            paymentMethod = "credit_card",
            wallet = "line_pay",
        ),
        // Google Pay
        Rule(
            bankPattern = Regex("Google Pay|GooglePay", RegexOption.IGNORE_CASE),
            textPattern = Regex("""(\d+)\s*元|NT\$?(\d+)|消費\s*(\d+)"""),
            bankName = "Google Pay",
            paymentMethod = "credit_card",
            wallet = "google_pay",
        ),
        // 街口支付
        Rule(
            bankPattern = Regex("街口"),
            textPattern = Regex("""(\d+)\s*元|NT\$?(\d+)|付款\s*(\d+)"""),
            bankName = "街口支付",
            paymentMethod = "prepaid_wallet",
        ),
    )

    fun shouldIgnore(title: String, text: String): Boolean {
        val combined = "$title $text"
        return ignorePatterns.any { it.containsMatchIn(combined) }
    }

    fun parse(title: String, text: String): ParsedNotification? {
        if (shouldIgnore(title, text)) return null

        val combined = "$title $text"

        // Detect wallet from title regardless of which rule matches
        val detectedWallet = walletPatterns.entries
            .firstOrNull { (_, pattern) -> pattern.containsMatchIn(combined) }
            ?.key

        for (rule in rules) {
            if (!rule.bankPattern.containsMatchIn(combined)) continue
            val match = rule.textPattern.find(combined) ?: continue
            val amountStr = match.groupValues.drop(1).firstOrNull { it.isNotEmpty() } ?: continue
            val amount = amountStr.toIntOrNull() ?: continue
            if (amount <= 0) continue
            return ParsedNotification(
                amount = amount,
                bankName = rule.bankName,
                paymentMethod = rule.paymentMethod,
                wallet = rule.wallet ?: detectedWallet,
            )
        }
        return null
    }

    private data class Rule(
        val bankPattern: Regex,
        val textPattern: Regex,
        val bankName: String,
        val paymentMethod: String,
        val wallet: String? = null,
    )
}
