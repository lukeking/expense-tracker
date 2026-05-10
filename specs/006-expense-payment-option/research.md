# Research: Explicit Payment Method Option for /expense

**Branch**: `006-expense-payment-option`
**Date**: 2026-05-10

## Current State Findings

### Discord Command Registration (`backend/scripts/register-commands.ts`)

- `/expense` has two options: `amount` (INTEGER, required) and `description` (STRING, required)
- No `payment_method` option exists on `/expense`
- `/refund` already has a `payment_method` option with 2 choices — confirms the pattern to follow
- Command description currently reads "記錄一筆現金支出" — implies cash only, needs updating

### Discord Handler (`backend/src/handlers/discord.ts`)

- `handleExpenseCommand` reads `amount` and `description` from options (lines 101–102)
- Calls `parseExpenseText` (Gemini) which returns `payment_method` from description text (line 115–127)
- Stores `parsed.payment_method` in `insertTransaction` (line 122)
- Confirmation message (lines 135–139) does **not** display `payment_method`

### Gemini Service (`backend/src/services/gemini.ts`)

- `parseExpenseText` (Discord flow) and `parseRawExpenseText` (Android flow) share `COMMON_PROMPT_RULES` which includes payment_method keyword mapping
- Per FR-003, payment keyword classification must be removed from the Discord parser (`parseExpenseText`) only — the Android path (`parseRawExpenseText`) is out of scope and must remain unchanged
- Separation requires a Discord-specific rule set that omits payment_method mapping while preserving the Android-specific prompt as-is

### Types (`backend/src/types.ts`)

- `PaymentMethod = 'credit_card' | 'prepaid_wallet' | 'easy_card' | 'bank_account' | 'cash'` — already defined
- `GeminiParseResult` includes `payment_method: PaymentMethod` — used by both Discord and Android paths

### Database (`backend/supabase/schema.sql`)

- `transactions.payment_method` column exists with CHECK constraint enforcing all 5 valid values
- No schema migration required

---

## Decisions

### Decision 1: Discord option `payment_method` value encoding

- **Decision**: Use internal enum strings as Discord option values (e.g., `value: 'credit_card'`), matching the `PaymentMethod` type directly
- **Rationale**: `/refund` already uses this pattern; no translation layer needed between Discord and DB
- **Alternatives considered**: Using Chinese labels as values — rejected because it would require a mapping step in the handler

### Decision 2: How to remove payment keyword parsing from `parseExpenseText`

- **Decision**: Extract a `DISCORD_PROMPT_RULES` constant that omits the payment_method mapping block. Keep `COMMON_PROMPT_RULES` for the Android `RAW_TEXT_SYSTEM_PROMPT`. Update `SYSTEM_PROMPT` (Discord) to use `DISCORD_PROMPT_RULES` instead of `COMMON_PROMPT_RULES`.
- **Rationale**: Cleanest separation — Android path unchanged; Gemini schema still returns `payment_method` (always `'cash'` when no keyword in description) so `GeminiParseResult` type is untouched
- **Alternatives considered**:
  - Override payment_method in handler only — simpler, but violates FR-003 (parser still classifies tokens)
  - Remove payment_method from `GeminiParseResult` — requires type changes, Android path breakage

### Decision 3: Confirmation message format

- **Decision**: Append `[支付方式]` inline at end of first summary line: e.g., `✅ 記帳成功！\n💰 金額：$300 [信用卡]\n...`
- **Rationale**: Confirmed in clarification session (Q3 → A: inline on existing summary line)
- **Alternatives considered**: Dedicated line — rejected per user preference

### Decision 4: `description` option required vs optional

- **Decision**: Keep `description` as required (no change)
- **Rationale**: Current behavior unchanged; spec does not modify description's required status
