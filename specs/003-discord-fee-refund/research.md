# Research: Discord Fee & Refund Commands

**Feature**: 003-discord-fee-refund | **Date**: 2026-05-09

All design decisions were settled during the spec clarification conversation. No external research was required — all answers came from existing codebase analysis and Discord API constraints.

---

## Decision 1: Parent lookup strategy

**Decision**: Single 90-day window, optional `parent` command option as search term. No progressive expansion.

**Rationale**: A `parent` search term naturally narrows results to 1–5 candidates, making a single query sufficient. Progressive window expansion adds complexity (multi-step state, additional button rows) with minimal benefit for a personal tool at ~50–100 transactions/month.

**Alternatives considered**:
- Progressive 7d → 30d → 90d expansion: rejected — requires persisting window state between button interactions; CF Workers are stateless.
- Show all 90-day candidates unprompted: rejected — too many buttons without a search term.

---

## Decision 2: Stateless insert-before-buttons pattern

**Decision**: Insert the fee/refund row with `parent_transaction_id = null` before presenting candidate buttons. Encode the transaction UUID in the `custom_id`. Update `parent_transaction_id` on button click.

**Rationale**: CF Workers have no in-memory state between the command response and the subsequent component interaction. Inserting first ensures no data loss if the user ignores the message.

**Alternatives considered**:
- Encode all fee data in `custom_id`: rejected — 100-char limit is too tight for anything beyond trivial descriptions.
- Use KV or Durable Objects for transient state: rejected — unnecessary complexity for a personal tool.

---

## Decision 3: Discord button label format

**Decision**: `NT$amount · MM/DD HH:MM` (UTC+8). Item name omitted.

**Rationale**: The user already knows what they searched for. Amount + timestamp is sufficient to distinguish candidates. `HH:MM` precision eliminates the edge case of same-amount same-day transactions. Max label length ~28 chars, well within Discord's 80-char limit.

**Alternatives considered**:
- Include item name: rejected — redundant given the search term already scopes the results; risks truncation for long names.
- Date only (no time): rejected — same-amount same-day is rare but possible; `HH:MM` adds only 6 chars.

---

## Decision 4: Two separate commands (`/fee` and `/refund`)

**Decision**: Two distinct slash commands.

**Rationale**: Fee adds to spend (foreign service charge), refund subtracts from spend (return or reimbursement). Different financial semantics warrant separate commands. Separate commands are more discoverable in Discord's slash command picker than a single command with a `type` option.

**Alternatives considered**:
- Single `/record-adjustment type:[fee|refund]`: rejected — less discoverable, mixes two opposite financial operations.

---

## Decision 5: No Gemini call for fee/refund

**Decision**: Skip Gemini parsing for `/fee` and `/refund`. Construct `items` directly from the `description` command option.

**Rationale**: `amount` is explicit (integer command option, no extraction needed). `description` is the verbatim item label, not freeform text to parse. Skipping Gemini saves ~1–2s latency and one external API call per command.

**Alternatives considered**:
- Call Gemini on `description` for tag extraction: rejected — tags are rarely useful for fee/refund transactions; not worth the latency cost.

---

## Discord API Constraints (from docs)

| Constraint | Value |
|-----------|-------|
| Button label max length | 80 characters |
| Buttons per message | 25 max (5 rows × 5 buttons) |
| `custom_id` max length | 100 characters |
| Interaction token TTL | 15 minutes |
| `fee_link:{uuid}:{uuid}` length | 82 characters ✅ |
