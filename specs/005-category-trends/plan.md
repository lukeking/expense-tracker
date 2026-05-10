# Implementation Plan: Category Tags & Trend Charts

**Branch**: `005-category-trends` | **Date**: 2026-05-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/005-category-trends/spec.md`

## Summary

Two improvements shipped together. **P1**: Replace Gemini-based `/expense` description parsing with a deterministic comma-delimited token parser — enabling `#category:subcategory` tags, multi-word item names, and item-sum validation. **P2/P3**: Extend `/summary` with a `period` parameter and QuickChart.io-generated pie/bar chart images, with Discord buttons for per-category subcategory drill-down. No new DB tables; categories are derived at read time by splitting the existing `tags: text[]` array on `:`.

---

## Technical Context

**Language/Version**: TypeScript (ESM, CF Workers runtime)
**Primary Dependencies**: Hono (router), Supabase JS client, Gemini API (Android path only), QuickChart.io (external chart rendering — HTTP fetch, no auth)
**Storage**: Supabase/PostgreSQL — existing `transactions.tags text[]` column; no new tables or columns
**Testing**: Vitest + `@cloudflare/vitest-pool-workers` (Miniflare)
**Target Platform**: Cloudflare Workers (Unbound plan — 30 s CPU wall time)
**Performance Goals**: SC-002 — chart visible in Discord within 5 s of `/summary`; SC-003 — drill-down within 3 s of button tap
**Constraints**: CF Workers 128 MB memory; deferred Discord response (type:5) required for all chart generation; QuickChart.io fetch ≤ 2 s p95 for typical payloads
**Scale/Scope**: Single user; ≤ ~1,000 transactions per period query; in-memory aggregation is safe at this scale

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First** — No new DB tables. No new infrastructure services. QuickChart.io is a single fetch call, not a new component. Deterministic parser replaces a Gemini API call on the hot path (net complexity reduction). No new abstractions beyond what the feature requires.
- [x] **II. Offline-First on Android** — Android pipeline is explicitly out of scope for this spec. No changes to Android WorkManager or Room.
- [x] **III. Serverless Boundary Compliance** — `/summary` uses deferred response (type:5); chart generation + Supabase query run inside `ctx.waitUntil()`. Drill-down button handler follows the same pattern. QuickChart.io fetch is a single HTTP call well within the 30 s wall-time.
- [x] **IV. Automation Over Manual Input** — `/expense` remains a single command; the new comma-delimited format is optional structure layered on the existing description field. No wizard, no required new fields.
- [x] **V. Security at System Boundaries** — QuickChart.io is called without auth (public API, no credentials). No new secrets. Existing ed25519 Discord verification and Supabase service role handling are unchanged.

*No gate failures. Complexity Tracking not required.*

---

## Project Structure

### Documentation (this feature)

```text
specs/005-category-trends/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
├── quickstart.md        ← Phase 1 output
├── contracts/
│   ├── expense-parser.md
│   ├── summary-command.md
│   └── drilldown-button.md
└── tasks.md             ← /speckit-tasks output (not yet)
```

### Source Code

```text
backend/
├── src/
│   ├── services/
│   │   ├── expense-parser.ts     ← NEW  deterministic comma-token parser
│   │   ├── chart.ts              ← NEW  QuickChart.io wrapper
│   │   ├── summary.ts            ← NEW  category aggregation + period helpers
│   │   ├── gemini.ts             ← MODIFIED  update tag-extraction rules for new format
│   │   └── [existing services unchanged]
│   ├── handlers/
│   │   └── discord.ts            ← MODIFIED  /expense, /summary, drilldown button handler
│   ├── db/
│   │   └── queries.ts            ← MODIFIED  add getTransactionsForPeriod()
│   └── types.ts                  ← MODIFIED  add SummaryPeriod type
└── tests/
    └── services/
        ├── expense-parser.test.ts ← NEW
        ├── chart.test.ts          ← NEW
        └── summary.test.ts        ← NEW
```

**Structure Decision**: Extending the existing single-project CF Workers backend. Three new service files, no new top-level directories.

---

## Phase 0: Research

*See [research.md](research.md) for full findings. Key decisions:*

| Decision | Chosen | Rejected |
|---|---|---|
| `/expense` parser | Deterministic TS (comma-split) | Gemini prompt update |
| Chart rendering | QuickChart.io (HTTP POST → PNG URL) | `node-canvas` / D3 / Recharts |
| Category aggregation | In-memory TypeScript grouping | SQL `unnest()` + `split_part()` |
| Drill-down state | Encoded in button `custom_id` | KV / DB session |

---

## Phase 1: Design

*See [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md) for full details.*

### Key Design Decisions

**Deterministic parser pipeline** (replaces Gemini on the `/expense` Discord path):
1. Split description on `,` → trim each token
2. Token starts with `#` → tag; if contains `:` → category tag (first `:` is delimiter); else → plain tag
3. Token is exact match to payment keyword set → payment_method
4. Token's last whitespace-separated word is numeric → line item (name = prefix, amount = number)
5. Remaining tokens → concatenated into note (space-separated)
6. After classification: if sum(item.amount) ≠ total → append mismatch warning to response

Gemini (`parseExpenseText`) remains for the Android notification path (`parseRawExpenseText`). The Gemini tag-extraction rule is updated to preserve `:` in tag strings (currently it strips `#` but the colon is passed through).

**QuickChart.io integration**:
- POST `https://quickchart.io/chart` with `{ type, data, options }` Chart.js config
- Returns `{ url: string }` — a short-lived hosted PNG URL
- Send as Discord embed `image.url`
- On fetch failure: fall back to text-only table (no error shown to user, text is always present)

**Category aggregation** (`summary.ts`):
```typescript
// For each transaction in period:
//   categoryTag = tags.find(t => t.includes(':')) ?? null
//   category = categoryTag ? categoryTag.split(':')[0] : '其他'
// Group by category → sum amounts
// Sort desc, cap at 5 for buttons (rest merged into 其他 slice)
```

**Drill-down button `custom_id`**: `summary_drilldown:{base64(category)}:{period}`
- Base64-encode category name to safely handle CJK in the 100-char limit
- Period enum values: `month | last-month | 3months | half-year | year | all`

**`/summary` command option**: Add `period` string option to Discord command registration (choices: month, last-month, 3months, half-year, year, all). Default: `month`.

**Period → date range** (`summary.ts → periodToDateRange()`):
- `month` → first day of current calendar month → now
- `last-month` → first day of previous month → last day of previous month
- `3months` → 3 months ago (same day) → now
- `half-year` → 6 months ago (same day) → now
- `year` → 12 months ago (same day) → now
- `all` → `new Date(0)` → now (entire history)
