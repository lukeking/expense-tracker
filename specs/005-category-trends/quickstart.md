# Quickstart: Category Tags & Trend Charts

**Branch**: `005-category-trends` | **Date**: 2026-05-09

## Prerequisites

- CF Worker deployed with spec 004 features (import, amend, fee, refund)
- At least 3 transactions recorded across ≥ 2 categories

---

## Scenario 1 — Basic Categorised Expense

```
/expense amount:300 description:信用卡, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50
```

**Expected response**:
```
✅ NT$300 · 麥當勞 [信用卡 · #食:午餐]
  · 大麥克套餐 NT$250
  · 蘋果派 NT$50
📊 本月支出：$X,XXX / $XX,XXX (XX%)
```

No warnings (250+50=300 ✓).

---

## Scenario 2 — Sum Mismatch Warning

```
/expense amount:350 description:現金, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50
```

**Expected response** includes:
```
⚠️ 項目合計 NT$300 ≠ 總金額 NT$350，差額 NT$50 未歸類
```

---

## Scenario 3 — Uncategorised Tag (plain #tag)

```
/expense amount:80 description:現金, #三商巧福
```

**Expected**: tag stored as `三商巧福` (no colon). Transaction counted under `其他` in summary.

---

## Scenario 4 — Category Summary Chart

```
/summary period:month
```

**Expected**: Deferred response → pie chart image + table of category totals + one Discord button per category (max 5).

---

## Scenario 5 — Drill-Down

After receiving the `/summary` response, tap the `食` button.

**Expected**: Bar chart showing subcategory breakdown under `食` for the same period (e.g., 午餐 NT$8,200 / 晚餐 NT$3,100).

---

## Scenario 6 — All-Time Summary

```
/summary period:all
```

**Expected**: Pie chart covering all recorded expenses from earliest transaction to today.

---

## Scenario 7 — Empty Period

```
/summary period:last-month
```
(assuming no transactions last month)

**Expected**: Text message `此期間無支出記錄` — no chart, no error.

---

## Scenario 8 — Chart Service Failure (simulated)

Block outbound requests to `quickchart.io` and run `/summary period:month`.

**Expected**: Text-only response with category table — no chart image, no error message to user.
