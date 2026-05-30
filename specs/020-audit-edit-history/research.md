# Research: Audit Edit History (020)

## Stack snapshot

| Layer | Technology |
|-------|-----------|
| Backend | Cloudflare Workers, Hono router, TypeScript |
| Database | Supabase PostgreSQL |
| PWA | React 18, Vite, TanStack Query v5 |

## Decision log

### D-001: Storage format — full snapshot vs. field diff

**Decision**: Store a `diff` JSONB object with `{ before, after }` sub-objects.

- Header fields that changed are represented as `{ "amount": { "before": 100, "after": 120 } }`. Fields that did not change are omitted.
- Items and adjustments (full array replace on every save) are stored as full array snapshots: `{ "before": [...], "after": [...] }`, omitted entirely if neither array changed.

**Rationale**: Pure field diffs enable compact display (only show what changed). Full array snapshots for items/adjustments are necessary because identity is positional — there is no stable per-item ID across edits (items are deleted and re-inserted). Storing the full "before" items array is sufficient for recovery.

**Alternatives considered**:
- Store only the "before" snapshot — simpler, but loses the "after" which helps confirm what was actually saved when there were multiple rapid edits.
- Store a flat text representation — readable but hard to render programmatically.

---

### D-002: Capture location — DB trigger vs. app-side

**Decision**: App-side capture in the PUT handler, before executing the update.

**Rationale**: Consistent with the spec decision (recorded in STATE.md) and with how `effective_amount` is computed (app-side). DB triggers require a migration and add a Supabase-specific dependency; app-side is explicit, testable, and already in the same CF Worker code path. The entire PUT operation remains atomic from the DB's perspective: read-before → diff → update → items replace → adjustments replace → history insert — all in sequence, no transactions needed (last-write-wins semantics already accepted for concurrent edits).

---

### D-003: No-op detection

**Decision**: Compute the diff before writing. If the diff is empty (no header fields changed, and items/adjustments arrays are deeply equal), skip the history insert.

**How to detect equality for items/adjustments**: JSON-stringify both arrays (sorted by stable field order) and compare strings. Items are compared by `{ name, amount, tags, note }`; adjustments by `{ kind, amount, note, basis, basis_value }`. Sort order / UUIDs are ignored.

---

### D-004: Tags field — what goes in the diff

The `transactions.tags` column stores only free tags (no-colon strings). The category tag is per-item via `transaction_items.tags`. The PUT body provides `category_tag` and `free_tags` separately; only `free_tags` goes to `transactions.tags`.

The diff for the header therefore covers `{ amount, payment_method, note, tags }` (free tags). The category tag is captured as part of the items array snapshot.

---

### D-005: History returned in GET /pwa/transactions/:id

**Decision**: Append history entries to the existing GET response rather than a new endpoint.

**Rationale**: Single round-trip — the edit sheet already calls this endpoint. History entries are ordered oldest-first, each containing `{ id, edited_at, diff }`.

---

### D-006: UI — collapsible history section

**Decision**: Add an `EditHistorySection` component at the bottom of `EditExpenseFormInner`. The section is hidden when `history` is empty or absent. When non-empty, a collapsed header "編輯紀錄 (N)" expands to a list of entries. Each entry shows `edited_at` formatted as a local datetime and a before/after diff summary.

**Entry rendering**:
- Header fields: one line per changed field — field label, before → after value.
- Items/adjustments: show count change ("3 品項 → 2 品項") or full list if expanded.
- No nested collapse per entry for simplicity in v1.
