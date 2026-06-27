# 031 — Entry UX refinement: 支出 / 手續費 / 退款 (Claude Design round-trip)

## Provenance

Reverse leg of the Claude Code ↔ Claude Design loop (see [[project-design-sync-roundtrip]]).
Source: Claude Design project **"Expense Tracker PWA"** (`369854a2-bbf9-468b-a3dc-8a3e02b43f26`),
files `entry-expense/optimized.html` + `entry-expense/analysis.html`. Both archived in
`pwa/design-preview/refined/entry-expense/`; the before-baseline is in `pwa/design-preview/baseline/`.

Key finding: refining a *page* in Design returns a **UX teardown (spec) + an optimized mockup**, not a
diffable edit. So "absorb back" = implement against the analysis as spec, using `optimized.html` as the
pixel reference — **not** a class-level diff. This spec is that implementation contract.

## Triage of Design's proposals

**🟢 Adopt — this spec (expense tab only, no backend, no domain change):**
1. 金額: 進頁 `autoFocus`、`inputMode="numeric"`。（Design 的欄內 `NT$` 前綴已拔除——NTD 單一幣別、label 已標 NTD,不做多幣值輸入/匯率。）
2. 折抵入口: 無字的 `▸` → 有字的「設定折抵 ›／⌄」。
3. 送出: 鈕上顯示金額（`送出 · NT$280`）;未齊全時**鈕面直接顯示「還差:…」**(取代獨立驗證行,
   用 `aria-disabled` 保持可讀/可朗讀,blocked 態用 muted 色而非 opacity-50)。
4. 區塊標題加彩色圓點做視覺區隔（金額/付款方式/分類/標籤/品項明細）。
5. 分類 major chips 加 **icon**（`CategoryPicker`,emoji,PWA-only）:DB 仍存單字名稱不變,
   未對應的 major 無 icon(graceful fallback)。共用元件 → expense + fee 都套用。

**🟡 Defer — needs backend/data, not this round:**
- 「複製最近一筆」快速範本（last-tx 資料）。
- 標籤「餐飲常用」分類別建議 pill（高頻標籤資料）。

**🔴 Reject — keep current logic / domain:**
- 分類 majors **改名**（食→餐飲、行→交通…）等於動 DB SSOT
  （[[project-categories-db-managed]]、[[reference-category-jiayong-allowance]]）→ 拒絕,維持單字名稱。
- 水平捲動 → 換行 grid 重排:本輪不做,維持現行水平捲動。
- 但「分類 chip 加 **icon**」這個純表現層的點子採納了 → 見 🟢 #5(只在 PWA 加,DB 不動)。

## Current-logic notes (the validation must respect these)

- **支出**: `canSubmit = amountVal > 0 && items.length > 0 && !categoryIncomplete`。分類**選填**（只有「選了 major 沒選 sub」才擋）。缺漏只列 金額/品項。
- **手續費**: `canSubmit = amountVal > 0 && !categoryIncomplete`。說明**選填**（留白自動帶入「國外交易服務費」）。缺漏只列 金額。
- **退款**: `canSubmit = amountVal > 0 && 說明非空`。說明**必填**。缺漏列 金額/說明。
- **fee 說明選填、refund 說明必填的不一致是刻意的**（pre-existing,非本 spec 新增；Design 觀察到並提出）:
  手續費的分類通常本身就能當說明、不需在描述重複;退款的分類會掛母分類,描述通常難以整進分類標籤或 plain tag,
  所以需要獨立的說明。→ 維持現狀,不對齊。
- 驗證一律**收進送出鈕**（blocked 顯示「還差:…」）,不另立一行;一切以**現行邏輯**為準,不照 Design 的
  optimized（它會加回 NT$、用獨立驗證行）。

## Scope of change

- `pwa/src/screens/EntryScreen.tsx` — `ExpenseForm` + `FeeForm` + `RefundForm`（三個 tab 全套設計語言）。
- `pwa/src/components/CategoryPicker.tsx` — major chip emoji icons（共用 → expense + fee）。
- `pwa/src/i18n/{zh,en}.ts` — new keys: `entry.adjToggle`, `entry.missingFields`,
  `entry.fieldAmount`, `entry.fieldItem`, `entry.fieldDescription`。

Deliberately skipped: 金額上下 stepper（對金額輸入無意義，純截圖產物）。

## Status & deferred

三個 tab 的視覺對齊**已完成**（expense → fee/refund,經一次 Design round-trip + 我方 triage）。

**Deferred to its own spec — 🟡「連結原始交易 → auto-fill」**: 連結原始交易升為主軸、連結後自動帶入下游
欄位（fee:付款/分類;refund:退款方式/金額）、全額退/部分退 + 原金額沖銷。需後端（ParentSearch 目前
result 不帶原交易的付款/金額/分類）,屬功能而非視覺,另開 spec 處理。

## Verification

1. `pnpm -C pwa typecheck` + pre-commit gate（backend 391 tests）綠。
2. Playwright 抓三個 tab（空 / 填值）:設計語言一致（dots、icon、autofocus、金額無 NT$、驗證收進按鈕）;
   refund 在「填金額但空說明」仍顯示「還差:說明」即證實刻意保留的不一致。
