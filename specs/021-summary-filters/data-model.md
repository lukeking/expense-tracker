# Data Model: Advanced Summary Filters

No database migration is required for this feature. All changes are to the API query interface and frontend state model.

---

## Frontend State Model

### `TimeBase`
```
'week' | 'month' | 'year' | 'all'
```
Replaces the old `WindowOption` type. Determines step size for ◀/▶ navigation and period picker granularity.

### Summary screen state

| Field | Type | Default | Description |
|---|---|---|---|
| `timeBase` | `TimeBase` | `'week'` | Active time granularity |
| `offset` | `number` | `0` | Steps back from current period (0 = current, -1 = previous) |
| `tag` | `string \| null` | `null` | Active plain-tag filter (null = no filter) |
| `paymentMethod` | `string \| null` | `null` | Active payment method filter (null = no filter) |
| `drilldown` | `string \| null` | `null` | Category drilldown (existing) |
| `pickerOpen` | `boolean` | `false` | Whether the PeriodPicker modal is open |

All state resets to defaults on app open (no persistence).

---

## `timeBaseToRange(base, offset)` return shape

```
{
  from: string;     // YYYY-MM-DD  (inclusive start)
  to: string;       // YYYY-MM-DD  (inclusive end)
  label: string;    // Human-readable: "May 2026" | "1–7 Jun" | "2026" | "全部"
}
```

### Week boundary rules
- `from` = date of the most-recent Sunday on or before today, shifted by `offset * 7` days
- `to` = `from + 6` days (Saturday)
- Label format: `"D MMM – D MMM"` (same year omitted on right side if same year), e.g. `"1–7 Jun"` or `"29 Dec – 4 Jan 2026"`

### Month boundary rules
- `from` = first day of `(currentYear, currentMonth + offset)` — JS `Date(y, m+offset, 1)` handles year wrap
- `to` = last day of that month
- Label format: `"MMM YYYY"` e.g. `"May 2026"`

### Year boundary rules
- `from` = `(currentYear + offset)-01-01`
- `to` = `(currentYear + offset)-12-31`
- Label: `"2026"`

---

## API Query Parameters (extended)

### `GET /pwa/summary`
| Param | Type | Required | Description |
|---|---|---|---|
| `from` | string (YYYY-MM-DD) | yes | Start date (existing) |
| `to` | string (YYYY-MM-DD) | yes | End date (existing) |
| `tag` | string | no | Filter to transactions carrying this plain tag |
| `payment_method` | string | no | Filter to transactions with this payment method |

### `GET /pwa/transactions`
| Param | Type | Required | Description |
|---|---|---|---|
| `from` | string | yes | Existing |
| `to` | string | yes | Existing |
| `category` | string | no | Existing (category drilldown) |
| `page` | number | no | Existing |
| `limit` | number | no | Existing |
| `tag` | string | no | Filter to transactions carrying this plain tag |
| `payment_method` | string | no | Filter to transactions with this payment method |

### `GET /pwa/summary/subcategories`
| Param | Type | Required | Description |
|---|---|---|---|
| `from` | string | yes | Existing |
| `to` | string | yes | Existing |
| `major` | string | yes | Existing |
| `tag` | string | no | Carry through active filter |
| `payment_method` | string | no | Carry through active filter |

---

## Frontend Components (new)

### `SummaryNav`
Props: `timeBase`, `offset`, `onTimeBaseChange(base)`, `onNavigate(delta: -1 | 1)`, `onPickerOpen()`

Renders:
- Row 1: [week] [month] [year] [全部] tab selector
- Row 2 (hidden when `timeBase === 'all'`): ◀  `{label}` ▶ — label is tappable, fires `onPickerOpen`

Right arrow is visually disabled when `offset === 0`.

### `PeriodPicker`
Props: `timeBase`, `currentOffset`, `onSelect(offset: number)`, `onClose()`

Internal state: `step` (1 = year select, 2 = period-within-year), `selectedYear`

Step 1 — Year list:
- Scrollable list of years from earliest possible (hardcoded 2015) to current year
- Current year highlighted
- Tap a year → for `year` mode: call `onSelect(yearOffset)` and close; for `month`/`week`: advance to step 2

Step 2 (month mode) — Month grid:
- 4×3 grid of month buttons (Jan–Dec)
- Future months in current year disabled
- Tap → compute offset and call `onSelect`

Step 2 (week mode) — Week list:
- Month tabs across top (Jan–Dec, scroll)
- List of week rows (Sun–Sat ranges) for the selected month
- Future weeks disabled
- Tap → compute offset and call `onSelect`

### `FilterBar`
Props: `tags: string[]`, `paymentMethods: string[]`, `activeTag: string | null`, `activePayment: string | null`, `onTagChange(tag: string | null)`, `onPaymentChange(pm: string | null)`

Renders two horizontally scrollable rows (or one row with visual separator):
- Tag chips: each tag from `tags` prop; active one highlighted; tap active to deselect
- Payment method pills: each method from `paymentMethods`; same toggle behavior

Hidden (not rendered) when `timeBase === 'all'`.
