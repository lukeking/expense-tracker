# Quickstart: E-Invoice CSV Import + /amend

**Branch**: `004-einvoice-csv-import` | **Date**: 2026-05-09

---

## Prerequisites

1. Branch `004-einvoice-csv-import` deployed to Cloudflare Workers
2. Supabase migration `004_einvoice_import.sql` applied
3. `/amend` and `/import` commands registered via `register-commands.ts`

```bash
cd backend
pnpm tsx scripts/register-commands.ts
```

Allow up to 1 hour for Discord command propagation.

---

## Phase 1 smoke test: `/amend`

### Happy path — amount correction

1. Record a test transaction:
   ```
   /expense amount:1500 description:Google Play 訂閱
   ```
2. Correct the amount after forex settlement:
   ```
   /amend amount:1523 parent:Google
   ```
3. Expected: bot shows a button list with the Google Play transaction
4. Click the button → bot message updates in place showing:
   `✅ 已修正：Google Play 訂閱 NT$1,500 → NT$1,523`

### No match → retype

1. Run `/amend amount:200 parent:XYZ電商`
2. Expected: "XYZ電商 找不到符合的交易。" with [🔍 重新搜尋] button
3. Click retype → modal opens pre-filled with "XYZ電商"
4. Change to a keyword that matches a real transaction → submit
5. Expected: candidate buttons appear for the corrected search

### Retype → save without link (cancel)

1. Run `/amend amount:200 parent:NotExists`
2. Click [取消] → message updates to "已取消。" with buttons cleared

---

## Phase 2 smoke test: `/import`

### Preparation

Create 3 test transactions manually in Discord:
```
/expense amount:180 description:全家 便利商店
/expense amount:320 description:麥當勞 午餐
/expense amount:1500 description:Google Play
```

Prepare a test CSV file (`test-invoices.csv`) matching the government format:

```csv
載具自訂名稱,發票日期,發票號碼,發票金額,發票狀態,折讓,賣方統一編號,賣方名稱,賣方地址,買方統編,消費明細_數量,消費明細_單價,消費明細_金額,消費明細_品名
/手機條碼,114/05/01,AB-12345678,180,正常,0,12345678,全家便利商店股份有限公司,台北市,,,,,
/手機條碼,114/05/02,AB-12345679,320,正常,0,87654321,冠誠生活股份有限公司,台中市,,1,320,320,餐飲
/手機條碼,114/05/03,AB-12345680,500,正常,0,99999999,未知商店,台北市,,,,, 
/手機條碼,114/05/04,AB-12345681,0,正常,0,11111111,零金額商店,台北市,,,,,
/手機條碼,114/05/05,AB-12345682,200,已作廢,0,22222222,已取消商店,台北市,,,,,
```

Expected outcomes:
- AB-12345678 (NT$180, 全家) → **matched** to the NT$180 全家 transaction
- AB-12345679 (NT$320, 冠誠生活) → **matched** to the NT$320 麥當勞 transaction (by amount+date)
- AB-12345680 (NT$500, 未知) → **auto_created** (no matching transaction)
- AB-12345681 (NT$0) → **skipped_zero**
- AB-12345682 (已作廢) → **skipped_voided**

### Run the import

In Discord, attach `test-invoices.csv`:
```
/import file:<attach test-invoices.csv>
```

Expected summary:
```
📥 發票匯入完成 · test-invoices.csv

✅ 已比對：2 筆
🆕 自動新增：1 筆
⏭️ 已略過（重複）：0 筆
🔄 外幣待確認：0 筆
⚠️ 無法解析：0 筆
```

### Re-import idempotency test

Run `/import` with the same file again.

Expected summary:
```
⏭️ 已略過（重複）：3 筆  (all 3 previously processed invoices)
🆕 自動新增：0 筆
```

### Forex match → amend → re-import test

1. Record a transaction at estimated rate:
   ```
   /expense amount:1500 description:Netflix 訂閱
   ```
2. Create a CSV with the settled amount (NT$1,523, within 1.5%):
   ```csv
   /手機條碼,114/05/06,NF-00000001,1523,正常,0,33333333,Netflix國際公司,台北市,,,,,
   ```
3. Import → expected: `🔄 外幣待確認：1 筆`
4. Correct the transaction:
   ```
   /amend amount:1523 parent:Netflix
   ```
5. Import any CSV (or the same one — NF-00000001 won't re-parse, but the reconciliation pass still runs):
   ```
   /import file:<any CSV with at least 1 new invoice>
   ```
6. Expected summary includes: `🔗 外幣已自動連結：1 筆`

---

## Running tests

```bash
cd backend
pnpm test
```

Key test files for this feature:
- `tests/services/csv-parser.test.ts` — encoding detection, ROC date, grouping, voided/zero filtering
- `tests/services/invoice-matcher.test.ts` — primary/secondary match, dedup, auto-create
- `tests/handlers/discord.test.ts` — /amend flow, /import command routing
- `tests/db/queries.test.ts` — amendTransactionAmount, invoice DB queries
