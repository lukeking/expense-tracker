# Research: Category Tags & Trend Charts

**Branch**: `005-category-trends` | **Date**: 2026-05-09

---

## Decision 1: `/expense` Description Parser

**Decision**: Deterministic TypeScript comma-split parser for the Discord `/expense` path.

**Rationale**: The new comma-delimited format (`信用卡, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50`) has fully unambiguous rules:
- Token classification order is deterministic (tag → payment → item → note)
- No natural language ambiguity remains after commas provide clear token boundaries
- Eliminates a Gemini API call on the hot path (latency + cost reduction)
- Pure functions are trivially unit-tested without mocking

**Alternatives considered**:
- *Gemini prompt update* — rejected: Gemini can still hallucinate on structured inputs; adding "last word is amount" rules to a language model is fragile. Deterministic TS is more reliable for this level of structure.

**Note**: `parseRawExpenseText` (Android notification path) continues to use Gemini — that input is genuinely unstructured natural language. `parseExpenseText` (Discord `/expense` path) is replaced by the new deterministic parser.

---

## Decision 2: Chart Rendering

**Decision**: QuickChart.io via HTTP POST — returns a hosted PNG URL sent as a Discord embed image.

**Rationale**:
- CF Workers has no DOM, no canvas, no native image libraries — all client-side chart renderers are ruled out
- QuickChart.io accepts a Chart.js config as JSON POST body and returns `{ url: string }` pointing to a PNG
- Zero auth, zero setup, free tier handles << 100 renders/month comfortably
- The PNG URL can be embedded directly in a Discord embed `image.url` field — Discord fetches and caches it
- Single `fetch()` call; no new npm dependency; no new secret

**Alternatives considered**:
- *`node-canvas` + `chart.js`* — requires native Node.js bindings (`canvas` npm package), unavailable in CF Workers sandbox
- *D3.js* — requires DOM manipulation; not viable in CF Workers
- *Recharts / Victory / Nivo* — all React-based; require browser rendering environment
- *Self-hosted chart service (Puppeteer headless)* — massive operational overhead; violates Principle I (Simplicity-First)

**Failure mode**: If QuickChart.io returns a non-200 or times out, the `/summary` handler falls back to text-only output (table of category totals). The user still gets useful data; no error is shown. Chart failure is logged internally.

---

## Decision 3: Category Aggregation Strategy

**Decision**: Fetch transactions for the period from Supabase (selecting `amount`, `tags`, `transaction_at`), aggregate categories in TypeScript in the CF Worker.

**Rationale**:
- Single user → max ~1,000 transactions/year → trivial in-memory grouping
- Avoids complex PostgreSQL `unnest()` + `split_part()` queries that are harder to test and harder to iterate on
- Category derivation logic (`split(':')[0]`) lives in one place alongside drill-down logic
- Simple Supabase query: `select amount, tags where transaction_type = 'expense' and transaction_at >= $start and transaction_at < $end`

**Alternatives considered**:
- *SQL `unnest()` + `split_part()` GROUP BY* — works but generates complex query strings, harder to unit test, overkill at this scale

---

## Decision 4: Drill-Down State Encoding

**Decision**: Encode category + period in the Discord button `custom_id`: `summary_drilldown:{b64category}:{period}`.

**Rationale**:
- Stateless — no KV or DB lookup needed to handle the button interaction
- Follows the existing pattern used by `/fee`, `/refund`, and `/amend` buttons (all encode state in `custom_id`)
- Base64-encoding the category name safely handles CJK characters within the 100-char `custom_id` limit (`食` base64 = `6aWt`, well within budget)
- Period values are short ASCII strings (max `half-year` = 9 chars)

**Alternatives considered**:
- *KV session storage* — adds infrastructure, unnecessary for single user, introduces TTL complexity
- *Supabase session row* — same objection; also requires cleanup logic

---

## Decision 5: Gemini Tag Rule Update

**Decision**: Update `COMMON_PROMPT_RULES` in `gemini.ts` to preserve the full tag string including `:` (currently strips `#` only, which already passes `:` through — no breaking change needed).

**Rationale**: The existing rule `"Extract all words with a leading '#' as tags by removing the '#' prefix"` already stores `食:午餐` as the tag string (colon preserved). The new category derivation (splitting on `:`) works on existing Gemini-generated tags without any migration. The only update needed is clarifying that freeform text without `#` and without a trailing number should NOT become an item — add explicit rule to Gemini prompt.
