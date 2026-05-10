# Contract: Category Drill-Down Button Interaction

**Handler**: `backend/src/handlers/discord.ts` → component interaction with `custom_id` starting with `summary_drilldown:`

## Button custom_id Format

```
summary_drilldown:{b64category}:{period}
```

- `b64category`: Base64 (standard, no padding) of the category string (e.g. `食` → `6aWt`)
- `period`: one of `month | last-month | 3months | half-year | year | all`
- Max total length: ~50 chars well within Discord's 100-char limit

## Parsing

```typescript
const [, b64cat, period] = customId.split(':');
const category = Buffer.from(b64cat, 'base64').toString('utf-8');
```

## Response Format

Discord deferred response (type:5), then PATCH with:

```
📊 {category} — {periodLabel} 子分類
[Bar chart image embed]

| 子分類 | 金額 |
|--------|------|
| 午餐   | NT$8,200 |
| 超市   | NT$4,140 |

💰 小計：NT$12,340
```

## Chart Spec (QuickChart.io)

```json
{
  "type": "bar",
  "data": {
    "labels": ["午餐", "超市"],
    "datasets": [{
      "label": "NT$",
      "data": [8200, 4140],
      "backgroundColor": "#36A2EB"
    }]
  },
  "options": {
    "indexAxis": "y",
    "plugins": { "legend": { "display": false } },
    "scales": { "x": { "ticks": { "callback": "v => 'NT$' + v.toLocaleString()" } } }
  }
}
```

Horizontal bar chart (`indexAxis: 'y'`) works better for CJK subcategory labels.

## Edge Cases

| Condition | Response |
|---|---|
| Category has no subcategory tags (plain tags only) | Single bar labelled `其他` with full category total |
| Category has zero transactions in period | Text: `此分類在此期間無支出記錄` (no chart) |
| QuickChart.io failure | Text-only table, no image, no error shown |
