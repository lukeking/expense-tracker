# Feature Specification: Discord Fee & Refund Commands

**Feature Branch**: `003-discord-fee-refund`
**Created**: 2026-05-09
**Status**: Draft
**Input**: Extension of spec 002 — spec.md clarification states "Both Discord and Android prompt" for fee/refund, but the 002 plan only implemented the Android side.

---

## Background

Feature 002 introduced `fee` and `refund` commands on the Android prompt. The original spec clarification (`spec.md:96`) explicitly requires these commands on Discord too. This spec covers the Discord-side implementation and fixes a latent bug in the budget calculation that becomes visible once refund rows exist.

---

## User Scenarios & Testing

### User Story 1 — Record a Foreign Transaction Fee via Discord (Priority: P1)

The user's credit card posts a foreign transaction service fee days after the original purchase. They type `/fee amount:47 description:國外交易服務費 parent:Airbnb` in Discord. The bot finds the Airbnb expense in the last 90 days and displays it as a button. The user taps the button. The bot creates a linked `fee` transaction for NT$47 and confirms with the updated budget summary.

**Independent Test**: Create an expense for NT$1,200 "Airbnb". Type `/fee amount:180 description:國外交易服務費 parent:Airbnb`. Verify a `fee` row exists in Supabase with `amount=180`, `transaction_type='fee'`, `parent_transaction_id=<Airbnb UUID>`. Verify the original NT$1,200 row is unchanged.

**Acceptance Scenarios**:

1. **Given** an expense for NT$1,200 "Airbnb" exists, **When** the user runs `/fee amount:180 description:國外交易服務費 parent:Airbnb`, **Then** a candidate button appears; tapping it creates the linked fee and shows the updated budget summary.
2. **Given** no matching expense for the search term exists, **When** the user runs `/fee amount:47 parent:某商店`, **Then** the bot confirms "No match found — saved as unlinked." and the fee is stored with `parent_transaction_id=null`.
3. **Given** the user omits `parent`, **When** the user runs `/fee amount:47 description:國外交易服務費`, **Then** the fee is saved immediately as unlinked with no candidate prompt.
4. **Given** multiple expenses match the search term (e.g. two Airbnb transactions), **When** the user runs `/fee amount:47 parent:Airbnb`, **Then** all matching candidates appear as buttons (up to 5). User selects one.
5. **Given** the user's credit card also posts a separate fee, **When** the user runs `/fee` for each, **Then** each fee is linked independently to its parent.

---

### User Story 2 — Record a Refund or Reimbursement via Discord (Priority: P1)

The user cancels a high-speed rail ticket and receives a refund, or files a business expense reimbursement. They type `/refund amount:800 description:退票 parent:高鐵`. The bot finds the original ticket purchase and creates a linked `refund` transaction. The budget summary correctly decreases by the refund amount.

**Independent Test**: Create an expense for NT$800 "高鐵票". Type `/refund amount:800 description:退票 parent:高鐵`. Verify a `refund` row exists with `amount=800`, `transaction_type='refund'`, `parent_transaction_id=<ticket UUID>`. Verify the budget summary shows spend reduced by NT$800.

**Acceptance Scenarios**:

1. **Given** a prior NT$800 "高鐵票" expense, **When** the user runs `/refund amount:800 description:退票 parent:高鐵`, **Then** the linked refund is created and the month's net spend decreases by NT$800.
2. **Given** a business trip expense of NT$3,200, **When** the user runs `/refund amount:3200 description:出差請領 parent:住宿`, **Then** the refund row is created and budget reflects the reimbursement.
3. **Given** the user omits `parent`, **When** the user runs `/refund amount:200 description:退款`, **Then** the refund is saved immediately as unlinked.
4. **Given** a partial refund scenario, **When** the user runs `/refund amount:400 parent:高鐵` against an NT$800 ticket, **Then** the partial refund (NT$400) is stored with `parent_transaction_id` set; the original transaction is unchanged.

---

### Edge Cases

- `amount` is zero or negative: Rejected immediately with an inline error message. No deferred response.
- `parent` search returns more than 5 matches: Show the 5 most recent only (ordered by `transaction_at DESC`). User can save unlinked if the right one isn't visible.
- User ignores the candidate buttons entirely: The fee/refund row already exists as unlinked (inserted before buttons are shown). No orphan data — it is a valid unlinked transaction.
- Same fee submitted twice within 3 minutes with the same amount: Caught by the existing dedup logic in `findExistingTransaction` (409 path); second attempt is silently rejected.

---

## Requirements

### Functional Requirements

- **FR-001**: Discord MUST expose `/fee` and `/refund` as separate slash commands, each with `amount` (required integer, min 1), `description` (optional string, default "國外交易服務費" / "退款"), and `parent` (optional string, search term for parent transaction lookup).
- **FR-002**: On invocation, the bot MUST respond immediately with a deferred message (type 5) and complete processing asynchronously.
- **FR-003**: If `parent` is provided, the bot MUST query the last 90 days of `expense`-type transactions using a case-insensitive substring match on item names and `note` field. Results are ordered by `transaction_at DESC`, capped at 5.
- **FR-004**: If candidates are found, the bot MUST present each as a Discord button showing `NT$amount · MM/DD` only (no item name — the user already knows what they searched for). A "Save unlinked" button MUST always be present.
- **FR-005**: When the user clicks a candidate button, the bot MUST set `parent_transaction_id` on the already-inserted fee/refund row and update the message to show the final confirmation with budget summary.
- **FR-006**: When the user clicks "Save unlinked" or no `parent` is provided or no candidates are found, the fee/refund row is kept with `parent_transaction_id=null` and the message shows a confirmation with budget summary.
- **FR-007**: The budget summary shown after any fee or refund MUST reflect the corrected formula: `Σ(expense) + Σ(fee) − Σ(refund)`. This requires fixing `getMonthlySpend`.
- **FR-008**: The fee/refund transaction row MUST be inserted before buttons are shown, so that an ignored message leaves a valid (unlinked) record rather than no record.

### Key Entities

No new entities. Uses the existing `Transaction` schema with `transaction_type='fee'|'refund'` and `parent_transaction_id UUID`.

---

## Success Criteria

- **SC-001**: A `/fee` or `/refund` command with a matching `parent` completes (linked record created + confirmation shown) in under 10 seconds.
- **SC-002**: A fee linked to a parent correctly appears in the budget summary as additive (fee increases spend).
- **SC-003**: A refund linked to a parent correctly decreases the net spend shown in the budget summary.
- **SC-004**: Omitting `parent` or finding no match never blocks the flow — the transaction is always saved.

---

## Clarifications

### Session 2026-05-09

- Q: Should `description` on `/fee` be used as a search term for the parent, or only as the fee's own label? → A: Only the fee's own label. The `parent` option is the search term. This avoids the ambiguity of "AirBnb 國外交易服務費" not matching "AirBnb" in the DB.
- Q: How many tries / time window expansions for parent lookup? → A: Single query, 90-day window. No progressive expansion — if no match, save unlinked. Simplicity over completeness.
- Q: Button label format? → A: Amount + date only (`NT$1,200 · 04/30`). Item name is redundant since the user already knows what they searched for. Fits comfortably within Discord's 80-character label limit.
- Q: One command with a type option, or two commands? → A: Two separate commands (`/fee` and `/refund`). Different financial semantics: fee adds to spend, refund subtracts. Separate commands are more discoverable in Discord's slash command picker.
- Q: Where is the budget calculation bug? → A: `getMonthlySpend` in `queries.ts` sums all amounts unconditionally. Once refund rows exist, they inflate spend instead of reducing it. Must be fixed in this feature.
