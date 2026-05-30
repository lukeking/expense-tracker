# Research: Advanced Summary Filters

## Decision 1 — Tag filtering location (in-Worker vs Supabase query)

**Decision**: Filter tags in the CF Worker after fetching from Supabase, not in the Supabase query.

**Rationale**: A transaction "carries" a tag if any of its own `tags[]` OR any of its `transaction_items[].tags[]` contains the plain tag. Supabase's `.overlaps()` can filter on the transaction-level `tags` column but cannot reach item-level tags in one query without a complex join or RPC. In-Worker filtering handles both levels correctly with the same code pattern already used for `category` filtering in `/pwa/transactions`.

**Alternatives considered**: Supabase `.overlaps('tags', [tag])` — rejected because it misses item-level tags and produces incorrect results (same problem the existing category filter has, which is why it was done app-side too).

---

## Decision 2 — Payment method filtering location

**Decision**: Apply `payment_method` filter directly in the Supabase query (`.eq('payment_method', paymentMethod)`) before fetching.

**Rationale**: `payment_method` is a direct column on the `transactions` table. Filtering at the Supabase layer avoids transferring unneeded rows to the Worker, which is more efficient than in-Worker filtering, especially for large date ranges.

---

## Decision 3 — `TimeBase` + `offset` model for time navigation

**Decision**: Replace the `WindowOption` string enum with a `TimeBase` ('week' | 'month' | 'year' | 'all') + integer `offset` (0 = current, -1 = one step back). A `timeBaseToRange(base, offset)` utility derives `{ from, to, label }`.

**Rationale**: The old `WindowOption` hardcoded specific relative ranges (本月, 近3個月, etc.). The new model supports arbitrary historical navigation with a single function. The offset is always relative to "now" so the current window is always offset=0, preventing stale state.

**Week boundary**: Sunday (day 0) to Saturday (day 6). Current week's Sunday is `today - today.getDay()`.

**Month boundary**: 1st to last calendar day of the target month. Month offset arithmetic uses `new Date(year, month + offset, 1)` which JavaScript handles correctly across year boundaries.

**Year boundary**: January 1 to December 31 of the target year.

---

## Decision 4 — Period picker UI structure

**Decision**: A modal overlay with a 2-step flow: (1) year list, (2) period-within-year selector.

- **year mode**: step 1 only — tap a year to confirm.
- **month mode**: step 1 → 4×3 month grid; future months in current year are disabled.
- **week mode**: step 1 → month tabs + week rows (Sun–Sat ranges) within the selected month; future weeks disabled.

**Rationale**: Tapping the header label is a common pattern (iOS Calendar, Google Calendar, most banking apps). A 2-step modal is lightweight, requires no third-party date-picker library, and gives the user enough context to jump from "I'm in May 2026" to "April 2019" in 3–4 taps.

---

## Decision 5 — Filter bar data source

**Decision**: The tag chip list and payment method pill list are derived from the currently fetched transaction set (the server response for the active time window), not from a separate API call.

**Rationale**: The tags and payment methods visible should be exactly those available in the current window. Deriving them from the fetched `transactions` array is free (no extra API call). When a filter is active the filter bar still shows all options from the unfiltered window (i.e., fetch without filter to populate chip list, apply filter for display).

**Implementation note**: The filter bar options are derived from a separate unfiltered `useTransactions` call (just for the current window, no tag/payment filter). The filtered data is used for totals and the transaction list. This avoids the chip list shrinking when a filter is applied (which would be confusing).

---

## Decision 6 — 'all' mode and filters

**Decision**: Tag and payment method filters are hidden and inactive when time base is 'all'. The filter bar is not rendered in 'all' mode.

**Rationale**: 'all' mode uses lazy-loaded monthly groups (`LazyHistoryGroup`). Applying a tag filter across all time with lazy loading would require fetching all transactions up front, defeating the purpose of lazy loading. Keeping filters out of 'all' mode avoids this complexity. Users who want to filter by tag should use year/month/week mode.

---

## Decision 7 — groupTransactions update

**Decision**: Update `groupTransactions` in `SummaryScreen` to use the new `TimeBase`:
- `week` → group by day (same key format as current 'month' mode: `YYYY-MM-DD`)
- `month` → group by day (unchanged)
- `year` → group by month (same as current non-month/last-month modes)
- `all` → group by month (unchanged, used by `LazyHistoryGroup`)
