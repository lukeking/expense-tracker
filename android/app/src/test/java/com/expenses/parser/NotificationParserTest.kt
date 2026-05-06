package com.expenses.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationParserTest {

    // ── Parsing tests ──────────────────────────────────────────────────────────

    @Test
    fun `parses 台新 credit card notification`() {
        val result = NotificationParser.parse(
            title = "台新銀行",
            text = "消費通知：台新銀行信用卡消費 NT$380 消費說明：全家便利商店"
        )
        assertNotNull(result)
        assertEquals(380, result!!.amount)
        assertEquals("台新銀行", result.bankName)
        assertEquals("credit_card", result.paymentMethod)
        assertNull(result.wallet)
    }

    @Test
    fun `parses 國泰 credit card notification`() {
        val result = NotificationParser.parse(
            title = "國泰世華信用卡",
            text = "消費 NT$250 星巴克"
        )
        assertNotNull(result)
        assertEquals(250, result!!.amount)
        assertEquals("國泰世華", result.bankName)
        assertEquals("credit_card", result.paymentMethod)
    }

    @Test
    fun `parses 玉山銀行 notification`() {
        val result = NotificationParser.parse(
            title = "玉山銀行",
            text = "消費通知 NT$150"
        )
        assertNotNull(result)
        assertEquals(150, result!!.amount)
        assertEquals("玉山銀行", result.bankName)
        assertEquals("credit_card", result.paymentMethod)
        assertNull(result.wallet)
    }

    // ── Wallet detection tests ─────────────────────────────────────────────────

    @Test
    fun `LINE Pay title sets wallet = line_pay`() {
        val result = NotificationParser.parse(
            title = "LINE Pay",
            text = "消費 150元 全聯福利中心"
        )
        assertNotNull(result)
        assertEquals("line_pay", result!!.wallet)
        assertEquals("credit_card", result.paymentMethod)
    }

    @Test
    fun `Google Pay title sets wallet = google_pay`() {
        val result = NotificationParser.parse(
            title = "Google Pay",
            text = "消費 NT$200"
        )
        assertNotNull(result)
        assertEquals("google_pay", result!!.wallet)
    }

    @Test
    fun `regular bank notification has wallet = null`() {
        val result = NotificationParser.parse(
            title = "玉山銀行",
            text = "刷卡消費 NT$300"
        )
        assertNotNull(result)
        assertNull(result!!.wallet)
    }

    // ── Ignore list tests ──────────────────────────────────────────────────────

    @Test
    fun `EasyCard auto top-up returns null (shouldIgnore)`() {
        assertTrue(NotificationParser.shouldIgnore("悠遊付", "自動加值 NT$500 成功"))
        val result = NotificationParser.parse("悠遊付", "自動加值 NT$500 成功")
        assertNull(result)
    }

    @Test
    fun `EasyCard 自動補值 also ignored`() {
        assertTrue(NotificationParser.shouldIgnore("悠遊卡", "自動補值 $200"))
        val result = NotificationParser.parse("悠遊卡", "自動補值 $200")
        assertNull(result)
    }

    @Test
    fun `ATM withdrawal notification returns null`() {
        assertTrue(NotificationParser.shouldIgnore("玉山銀行", "ATM 提款 NT$3,000"))
        val result = NotificationParser.parse("玉山銀行", "ATM 提款 NT$3,000")
        assertNull(result)
    }

    @Test
    fun `ATM 提現 also ignored`() {
        assertTrue(NotificationParser.shouldIgnore("台新銀行", "提現 NT$5000 成功"))
        val result = NotificationParser.parse("台新銀行", "提現 NT$5000 成功")
        assertNull(result)
    }

    // ── Non-payment notifications ──────────────────────────────────────────────

    @Test
    fun `returns null for non-payment notifications`() {
        val result = NotificationParser.parse(
            title = "Facebook",
            text = "Luke liked your photo"
        )
        assertNull(result)
    }

    @Test
    fun `returns null for system notifications`() {
        val result = NotificationParser.parse(
            title = "充電中",
            text = "充電 80%"
        )
        assertNull(result)
    }

    @Test
    fun `returns null when amount is 0 or negative`() {
        val result = NotificationParser.parse(
            title = "台新銀行",
            text = "消費通知 NT$0"
        )
        assertNull(result)
    }
}
