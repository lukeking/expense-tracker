# Contract: /summary Discord Command

**Handler**: `backend/src/handlers/discord.ts` → `commandName === 'summary'`

## Discord Command Registration

```typescript
{
  name: 'summary',
  description: '查看支出分類圓餅圖',
  options: [
    {
      name: 'period',
      description: '時間區間',
      type: 3, // STRING
      required: false,
      choices: [
        { name: '本月', value: 'month' },
        { name: '上個月', value: 'last-month' },
        { name: '近3個月', value: '3months' },
        { name: '近半年', value: 'half-year' },
        { name: '近一年', value: 'year' },
        { name: '全部', value: 'all' },
      ],
    },
  ],
}
```

## Response Format

Discord deferred response (type:5), then PATCH with:

```
📊 {periodLabel} 支出分類
[Pie chart image embed]

| 分類 | 金額 | 占比 |
|------|------|------|
| 食   | NT$12,340 | 45% |
| 行   | NT$5,200  | 19% |
| 其他 | NT$9,800  | 36% |

💰 合計：NT$27,340

[Button: 食] [Button: 行]   ← top-5 categories only
```

## Period → Date Range

| Period | Start (inclusive) | End (exclusive) |
|---|---|---|
| `month` | First day of current calendar month 00:00 UTC | now |
| `last-month` | First day of previous month 00:00 UTC | First day of current month 00:00 UTC |
| `3months` | 3 months ago (same day) 00:00 UTC | now |
| `half-year` | 6 months ago (same day) 00:00 UTC | now |
| `year` | 12 months ago (same day) 00:00 UTC | now |
| `all` | `new Date(0)` | now |

## Chart Spec (QuickChart.io)

```json
{
  "type": "pie",
  "data": {
    "labels": ["食", "行", "其他"],
    "datasets": [{
      "data": [12340, 5200, 9800],
      "backgroundColor": ["#FF6384","#36A2EB","#FFCE56","#4BC0C0","#9966FF","#C9CBCF"]
    }]
  },
  "options": {
    "plugins": {
      "legend": { "position": "right" },
      "datalabels": { "formatter": "(v,c) => c.chart.data.labels[c.dataIndex] + '\\nNT$' + v.toLocaleString()" }
    }
  }
}
```

POST to `https://quickchart.io/chart/create` → `{ url: string }`

## Fallback (chart service failure)

If QuickChart.io returns non-200 or throws: omit the image embed, include only the text table. No error message shown.

## Category Button Limit

Maximum 5 buttons per message (Discord ActionRow limit = 5 components). If > 5 categories exist: top-5 by total get buttons; remainder shown in `其他` slice with no button.
