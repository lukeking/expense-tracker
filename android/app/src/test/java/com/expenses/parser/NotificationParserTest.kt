package com.expenses.parser

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationParserTest {

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
    fun `parses LINE Pay notification`() {
        val result = NotificationParser.parse(
            title = "LINE Pay",
            text = "消費 150元 全聯福利中心"
        )
        assertNotNull(result)
        assertEquals(150, result!!.amount)
        assertEquals("LINE Pay", result.bankName)
        assertEquals("mobile_pay", result.paymentMethod)
    }

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
