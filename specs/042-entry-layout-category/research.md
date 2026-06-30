# Research: Entry Fee/Refund Layout + Major-Category Selector

**Feature**: 042-entry-layout-category | **Date**: 2026-06-29

The big decisions (unified order, link-as-primary, refund-description-required, client-side frequency, scope) were settled with the user before specifying. This document records the few implementation-level unknowns and their resolutions.

## D1. Category-usage frequency source (the one real unknown)

**Question**: Where does "most-used" ranking come from, given categories are stored as `主:子` colon-tags inside `TxRecord.tags` (and item tags), not a dedicated column, and the entry screen currently loads no transaction list?

**Decision**: Compute **client-side from a single bounded recent-transactions fetch**, in a new `useCategoryUsage` hook. Reuse the existing `/pwa/transactions` endpoint over a recent window (≈ last 180 days), fetched once with a long `staleTime` (react-query cache), then `useMemo` a count over the rows: for each transaction, collect the distinct `主:子` colon-tags from `tags` + `items[].tags`, recognise the `主` against the `useCategories` major set, and increment per-major and per-`主:子` counts. Expose `majorRank: string[]` and `subRank: Map<major, string[]>`. Tie-break and unseen categories fall back to the DB `sort_order`/existing order.

**Rationale**:
- Honors the user's explicit instruction ("client side, compute once, cache") and FR-013 ("no new server capability").
- True **frequency (count)**, which is what 使用量 means — not spend amount.
- One bounded fetch, memoized; per the user, counting is sub-millisecond and won't block interaction.

**Alternatives considered**:
- **`/pwa/summary` major totals (by amount)** — tiny, pre-aggregated, existing. **Rejected**: ranks by spend, not count, so a once-a-month-but-large category (e.g. 住/rent) would wrongly outrank a daily-but-small one (食) — backwards for "frequently entered".
- **New `/pwa/category-usage` count endpoint** — cleanest data. **Rejected**: adds backend surface; the user asked for client-side and the constitution prefers fewer moving parts. Revisit only if the client-side fetch proves too heavy.
- **Count only what's already in react-query cache** — zero fetch. **Rejected**: unreliable; entry is often the first screen, cache may be empty.

## D2. Always-visible major count (top-N)

**Decision**: Show a frequency-ranked top-N inline + a 「⋯ 更多」 chip; **N tuned to fit one row at 390px** with the emoji-prefixed single-character chips (expected ≈ 3–4). Implement N as a single constant so it's trivially adjustable.

**Rationale**: User wants "看版面塞不塞得下" (fit-driven). Single-character + emoji chips are narrow; a small N + 更多 keeps one row and zero horizontal scroll (SC-002). The design mockup (expense) used flex-wrap with 7 + 更多; we prefer top-N single-row to avoid the "臃腫" multi-row look the user rejected.

**Alternatives**: flex-wrap all (rejected — bulky); native dropdown (rejected — loses at-a-glance tap targets).

## D3. Overflow presentation

**Decision**: Reuse the existing `BottomSheet` (already imported by `CategoryPicker` for the sub-category overflow) for the major 「更多」 list — a grid of all majors with emoji icons. No new component.

**Rationale**: Consistency with the existing sub-overflow UX; Simplicity-First.

## D4. Ordering stability within a session

**Decision**: Ranking is computed once per session (the fetch + memo are stable for the session via react-query `staleTime`); it does **not** recompute/reshuffle when the user adds an entry mid-session. Deterministic tie-break by `sort_order` then name.

**Rationale**: Avoids the disorienting "chips jump around" problem (Edge Cases). Matches the user's "進 app 算一次 cache".

## D5. Link-card content & direction cues (Scope A)

**Decision**: Promote `ParentSearch`'s linked state to a **rich card**: 🔗 + original description (`note ?? item_names[0] ?? tags[0]`) + a meta line `payment_method · category · NT$amount · date` + ✕ clear — matching the synced `entry-fee/optimized.html` / `entry-refund/optimized.html`. `ParentSearchResult` already carries all needed fields (`payment_method`, `category`, `amount`, `transaction_at`, `note`, `item_names`), so **no contract/data change**. Direction cues are pure styling/labels in `EntryScreen` (fee 金額 → 附加成本; refund 金額 → green `+ NT$ … 退回`). The refund full/partial chips + 原金額 hint live inside/under the card and drive the existing `全額退款` amount behavior.

**Rationale**: The needed data already arrives with the search result (spec 041 backend); this is presentation only.

## D6. Required-field rule (resolved in spec)

Refund 說明 stays **required**, fee 說明 stays **optional** (FR-006). This resolves the design's "待決策"; no further research — domain rationale recorded in [[project-design-sync-roundtrip]] and spec 031.

## D7. i18n

**Decision**: All new visible strings added to both `zh.ts` and `en.ts`; `pnpm i18n:check` is the parity gate (skips comments / honors `i18n-allow` since PR #71). New keys include the readiness hint, fee「附加成本」, refund「退回」, full/partial labels, 「更多」, and any link-card labels. Reuse existing `entry.fullRefund`; update `entry.linkOriginal` (drop the "（可選）" suffix since it's now the primary axis).

## Open items deferred to implementation

- Exact N for top-N majors (constant; verify single-row fit at 390px).
- Recent-window length for the usage fetch (start at ~180 days; adjust if sample too small/large).
- Whether to also frequency-order the sub-overflow sheet list (yes, same ranking).
