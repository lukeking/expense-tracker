# 自動化記帳系統架構提案 (Discord Bot + Android 監聽)

## 這份文件定義了一套針對「極致自動化」與「低阻力手動補帳」開發的記帳軟體架構。系統結合 Android 通知監聽、財政部載具 API 以及 Discord 作為操作介面。

## Clarifications

### Session 2026-05-05
- Q: Where will the Python backend be hosted? → A: Cloudflare Workers (serverless, TypeScript runtime); database is Supabase (hosted PostgreSQL). Note: FastAPI/discord.py cannot run on CF Workers — backend language changes to TypeScript; Discord integration uses Interactions Webhook (HTTP-based) instead of gateway long-polling.
- Q: Is this system personal (single user) or multi-user? → A: Single user — personal tool, all data belongs to one owner. No user_id partitioning needed; no access control layer required beyond Discord webhook signature verification.
- Q: What happens when multiple unmatched transactions share the same amount in the matching time window? → A: Flag both as ambiguous via Discord message and await manual user confirmation before writing the match.
- Q: How is the budget organized? → A: Single monthly total budget target + freeform tags per transaction (e.g. food, transport). No per-category budget caps in Phase 1.
- Q: Which 財政部 API carrier type does the user use? → A: 手機條碼 (Mobile barcode). Auth flow uses barcode ID + verification code; no citizen certificate infrastructure needed.

### 系統架構圖描述
- 系統採用 離線優先 (Offline-first) 與 非同步對齊 (Asynchronous Reconciliation) 策略。

- 感知端 (Sensor): Android Notification Listener。
- 控制端 (Controller): Cloudflare Workers (TypeScript)。
- 資料庫 (Storage): Supabase (PostgreSQL)。
- 外部介面 (API): 財政部電子發票平台。
- 使用者介面 (UI): Discord App (Interactions Webhook)。

### 核心工作流程 (Workflow)

#### 信用卡/電子支付 (95% 自動化)
  - 觸發: 消費發生，銀行 App 發送推播通知。
  - 攔截: Android App 監聽到通知，解析金額與銀行名稱，立即 POST 到 Python 後端。
  - 預警: 後端更新資料庫，並透過 Discord Bot 發送即時訊息告知當月總預算進度（單一月度總額）。每筆消費可附加自由標籤（如 food、transport），用於事後篩選，但標籤無獨立預算上限。
  - 補全:
      隔日 Python 後端定時向財政部 API 請求載具明細。
  - 系統依據 [金額] 與 [時間視窗] 進行自動對齊。
  - 對齊成功後，Discord Bot 自動更新（編輯）該筆消費訊息，補充品項與自動標籤。
  - 衝突處理: 若同一時間視窗內存在多筆金額相同的未對齊紀錄，系統將透過 Discord 發送模糊提示訊息，列出候選筆數，等待使用者手動確認後才寫入匹配結果。

#### 現金消費 (5% 手動補錄)
  - 觸發: 使用者於 Discord 頻道輸入 Prompt（例如：150 燙青菜 牛肉麵）。
  - 解析: Python 後端接收訊息，利用 Regex 或簡單語意分析拆分金額與細項。
  - 記錄: 存入資料庫並回傳當前預算狀態。

### 分階段開發計劃 (Phased Roadmap)

#### 第一階段：核心引擎與互動介面 (The Core)
  - 目標：建立基礎數據結構與「Prompt 式」輸入體驗，達成初步可用的記帳系統。
  - Discord Bot: 實作基礎指令解析，支援手動輸入金額與品項。
  - 後端與資料庫: 使用 Cloudflare Workers 建立 API 端點，資料庫採用 Supabase (PostgreSQL)。
  - AI 分析整合: 串接 Gemini API 進行 Prompt 語意分析，將隨意描述轉化為結構化 JSON。
  - 階段成果: 可透過 Discord 頻道進行手動記帳，並即時回報當月支出與預警。

#### 第二階段：全自動化與數據對齊 (The Automation)
  - 目標：消除手動輸入負擔，達成自動追蹤與明細填補。
  - Android 監聽器: 實作 Kotlin 版通知監聽 App，自動將銀行通知 POST 到後端。
  - 財政部 API 串接: 使用手機條碼 (Mobile barcode) + 驗證碼進行身份驗證，透過 CF Workers Cron Trigger 定時抓取載具發票明細。
  - 自動對齊算法: 實作金額與日期匹配邏輯，自動合併「銀行通知」與「發票明細」。
  - 階段成果: 達成 95% 以上消費完全自動化紀錄，並具備精確的品項細項與標籤。

### 技術規格 (Technical Stack)

#### Android 監聽器
  - Language: Kotlin
  - 核心組件: NotificationListenerService
  - 機制: 支援離線暫存與 WorkManager 背景重傳。

#### 後端 (Cloudflare Workers)
  - Runtime: TypeScript (Cloudflare Workers)。
  - Discord 整合: Interactions Webhook (HTTP POST, 無 gateway 長連線)。
  - 定時任務: CF Workers Cron Triggers (取代 Python 排程器)。
  - 解析引擎: Regex Parser 與 LLM 自然語言處理 (Gemini API via HTTP)。

### 資料模型設計 (Data Schema)

|欄位名稱|類型|說明|
|:---|:---|:---|
|id|UUID|Primary Key|
|amount|integer|金額 (新台幣，整數)|
|items|JSONB|品項名稱與金額|
|is_matched|Boolean|是否已與發票對齊|
|tags|text[]|自由標籤（如 food, transport）|
|monthly_budget|integer|當月預算總額（設定值，非欄位）|

> 資料模型為單一使用者設計，無需 user_id 欄位。Discord 安全性依賴 Interactions Webhook 簽章驗證；Android 端採用靜態 API Key 存取 CF Worker 端點。