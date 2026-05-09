# Quickstart: Discord Fee & Refund Commands

**Feature**: 003-discord-fee-refund | **Date**: 2026-05-09

---

## Prerequisites

- Cloudflare Worker deployed with existing `/expense` command working
- Supabase `transactions` table has `transaction_type`, `parent_transaction_id` columns (already exists)
- `pnpm` available; `backend/` dependencies installed

---

## Development Flow

### 1. Implement (in order)

```bash
# All changes are in backend/src/db/queries.ts and backend/src/handlers/discord.ts
# No new files required
```

**T001 — Fix getMonthlySpend** (prerequisite):
- `backend/src/db/queries.ts`: add `transaction_type` to `.select()`, subtract refund amounts in reduce

**T002 — Add findParentCandidates**:
- `backend/src/db/queries.ts`: new function querying expense rows by search term, 90-day window, limit 5

**T003/T004 — Add handlers** (parallel):
- `backend/src/handlers/discord.ts`: `handleFeeCommand`, `handleRefundCommand`

**T005 — Extend component interaction**:
- `backend/src/handlers/discord.ts`: handle `fee_link:`, `fee_unlink:`, `refund_link:`, `refund_unlink:` prefixes

**T006 — Register commands**:
- `backend/scripts/register-commands.ts`: add `/fee` and `/refund` definitions

### 2. Test locally

```bash
cd backend
pnpm test
```

All 3 test suites should pass (75+ tests).

### 3. Deploy

```bash
cd backend
pnpm deploy
```

### 4. Register slash commands with Discord

```bash
cd backend
pnpm register-commands
```

This must be run after deploy whenever command definitions change. Commands appear in Discord within seconds.

---

## Smoke Test Sequence

After deploy + registration:

1. `/fee amount:47` — should save unlinked, show budget summary
2. `/fee amount:47 description:AirBnb服務費` — same, with custom label
3. `/fee amount:47 parent:Airbnb` — should show candidate buttons (requires a matching expense in last 90 days)
4. Click a candidate button — should confirm "✅ 費用已連結！" with budget
5. Click "儲存（不連結）" — should confirm "✅ 費用已儲存（未連結）"
6. `/refund amount:200` — should save unlinked, budget decreases
7. `/refund amount:200 parent:高鐵` — same flow as fee with parent search

---

## Key Implementation Notes

### Insert-before-buttons pattern

Fee/refund rows are inserted **before** presenting candidate buttons. The row starts with `parent_transaction_id = null`. Button click updates it. This ensures no data loss if the user ignores the Discord message (the row persists as a valid unlinked transaction).

### custom_id encoding

```
fee_link:{fee_tx_id}:{parent_tx_id}    // 36+1+36 = 73 + 9 prefix = 82 chars max
fee_unlink:{fee_tx_id}                 // 36 + 10 prefix = 46 chars
refund_link:{fee_tx_id}:{parent_tx_id} // 82 + 2 = 84 chars — wait, still within 100 ✅
refund_unlink:{fee_tx_id}              // 46 + 2 = 48 chars ✅
```

Both within Discord's 100-character `custom_id` limit.

### Button label format

```typescript
const dt = new Date(row.transaction_at);
const utc8 = new Date(dt.getTime() + 8 * 60 * 60 * 1000);
const mm = String(utc8.getUTCMonth() + 1).padStart(2, '0');
const dd = String(utc8.getUTCDate()).padStart(2, '0');
const hh = String(utc8.getUTCHours()).padStart(2, '0');
const min = String(utc8.getUTCMinutes()).padStart(2, '0');
const label = `NT$${row.amount.toLocaleString()} · ${mm}/${dd} ${hh}:${min}`;
```

### getMonthlySpend formula

```
net = Σ(expense.amount) + Σ(fee.amount) − Σ(refund.amount)
```

Refund rows have positive `amount` values but are subtracted from the budget total.
