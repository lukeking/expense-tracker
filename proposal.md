# 自動化記帳系統架構提案 (Discord Bot + Android 監聽)

## 這份文件定義了一套針對「極致自動化」與「低阻力手動補帳」開發的記帳軟體架構。系統結合 Android 通知監聽、財政部載具 API 以及 Discord 作為操作介面。

### 系統架構圖描述
- 系統採用 離線優先 (Offline-first) 與 非同步對齊 (Asynchronous Reconciliation) 策略。

- 感知端 (Sensor): Android Notification Listener。
- 控制端 (Controller): Python (FastAPI + Discord.py)。
- 資料庫 (Storage): PostgreSQL / SQLite。
- 外部介面 (API): 財政部電子發票平台。
- 使用者介面 (UI): Discord App。

### 核心工作流程 (Workflow)

#### 信用卡/電子支付 (95% 自動化)
  - 觸發: 消費發生，銀行 App 發送推播通知。
  - 攔截: Android App 監聽到通知，解析金額與銀行名稱，立即 POST 到 Python 後端。
  - 預警: 後端更新資料庫，並透過 Discord Bot 發送即時訊息告知目前總預算進度。
  - 補全:
      隔日 Python 後端定時向財政部 API 請求載具明細。
  - 系統依據 [金額] 與 [時間視窗] 進行自動對齊。
  - 對齊成功後，Discord Bot 自動更新（編輯）該筆消費訊息，補部品項與自動標籤。

#### 現金消費 (5% 手動補錄)
  - 觸發: 使用者於 Discord 頻道輸入 Prompt（例如：150 燙青菜 牛肉麵）。
  - 解析: Python 後端接收訊息，利用 Regex 或簡單語意分析拆分金額與細項。
  - 記錄: 存入資料庫並回傳當前預算狀態。

### 分階段開發計劃 (Phased Roadmap)

#### 第一階段：核心引擎與互動介面 (The Core)
  - 目標：建立基礎數據結構與「Prompt 式」輸入體驗，達成初步可用的記帳系統。
  - Discord Bot: 實作基礎指令解析，支援手動輸入金額與品項。
  - 後端與資料庫: 使用 FastAPI 建立 API 端點，並配置資料庫（SQLite/PostgreSQL）。
  - AI 分析整合: 串接 Gemini API 進行 Prompt 語意分析，將隨意描述轉化為結構化 JSON。
  - 階段成果: 可透過 Discord 頻道進行手動記帳，並即時回報當月支出與預警。

#### 第二階段：全自動化與數據對齊 (The Automation)
  - 目標：消除手動輸入負擔，達成自動追蹤與明細填補。
  - Android 監聽器: 實作 Kotlin 版通知監聽 App，自動將銀行通知 POST 到後端。
  - 財政部 API 串接: 實作定時同步邏輯，抓取發票明細。
  - 自動對齊算法: 實作金額與日期匹配邏輯，自動合併「銀行通知」與「發票明細」。
  - 階段成果: 達成 95% 以上消費完全自動化紀錄，並具備精確的品項細項與標籤。

### 技術規格 (Technical Stack)

#### Android 監聽器
  - Language: Kotlin
  - 核心組件: NotificationListenerService
  - 機制: 支援離線暫存與 WorkManager 背景重傳。

#### Python 後端
  - Framework: FastAPI + discord.py。
  - 解析引擎: Regex Parser 與 LLM 自然語言處理。

### 資料模型設計 (Data Schema)

|欄位名稱|類型|說明|
|:---|:---|:---|
|id|UUID|Primary Key|
|amount|integer|金額|
|items|JSONB|品項名稱與金額|
|is_matched|Boolean|是否已與發票對齊|