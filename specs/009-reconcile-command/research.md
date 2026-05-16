# Research: Standalone Invoice Reconciliation Command

**Branch**: `009-reconcile-command` | **Date**: 2026-05-10

## Decision 1: Command Structure — One Command vs. Subcommands

**Decision**: Single `/reconcile` command, no subcommands.

**Rationale**: The auto-reconciliation pass is idempotent. Running it when nothing changes is harmless and takes milliseconds (only DB reads if no Gemini calls are needed). The pass output already serves as the held invoice list (US3). Adding a `/reconcile list` subcommand would add Discord command registration complexity for zero user-facing benefit — the user can just run `/reconcile` to see what's held.

**Alternatives considered**:
- `/reconcile list` subcommand — rejected (Simplicity-First; idempotent pass makes it redundant)
- Separate `/reconcile-list` command — rejected (same reason)

## Decision 2: Candidate IDs for Ambiguous Invoices Are Not Persisted

**Decision**: Re-query `findMatchingExpenseTransaction` for each `ambiguous` invoice at reconcile time.

**Rationale**: The existing `insertInvoice(..., 'ambiguous')` call stores no `matched_transaction_id` (only set for `matched` / `auto_created`). The candidate transactions are only tracked in-memory during the import pipeline for the summary message. At reconcile time, re-querying is correct behavior — the candidate set may have changed (a duplicate transaction deleted, a transaction's amount amended), which is exactly the point of the reconcile pass.

**Alternatives considered**:
- Store candidate IDs in a separate `invoice_candidates` join table at import time — rejected (schema change, added complexity, stale data problem)
- Store candidate IDs as a JSONB array on the `invoices` row — rejected (same issues; re-querying is cheaper and always fresh)

## Decision 3: Extend `runReconciliationPass` for Ambiguous Invoices

**Decision**: Add a second loop inside `runReconciliationPass` (in `invoice-matcher.ts`) that processes `ambiguous` invoices with exactly 1 current candidate → auto-link them.

**Rationale**: The function already abstracts the reconciliation logic for `held_forex`. Extending it keeps the reconciliation logic in one place (single source of truth) and means both the `/import` post-pass and the new `/reconcile` command benefit from the fix automatically.

**Alternatives considered**:
- Separate `runAmbiguousReconciliationPass` function — rejected (duplication; callers would need to call both)
- Inline the logic in the new handler — rejected (duplicates existing code)

## Decision 4: Discord Button Custom ID Format

**Decision**: `reconcile_link:{invoiceId}:{transactionId}` and `reconcile_skip:{invoiceId}`.

**Rationale**: Consistent with existing patterns (`fee_link:{txId}:{parentId}`, `amend_select:{amount}:{txId}`). UUIDs are 36 chars; `reconcile_link:` is 15 chars → total 87 chars, within Discord's 100-char limit. Simple colon-split parsing, no encoding needed.

**Alternatives considered**:
- JSON payload — rejected (hits 100-char limit immediately with UUIDs)
- Base64 encoded — rejected (unnecessary complexity; colon-split is sufficient)

## Decision 5: Candidate Count Cap for Button Display

**Decision**: Show up to 5 candidate transactions as buttons (Discord action row max). If more than 5 candidates exist (highly unlikely for this use case), show the 5 most-recently-created by `created_at DESC`.

**Rationale**: Discord limits each action row to 5 buttons, and the existing codebase already applies the 5-button cap pattern in `handleFeeOrRefundCommand` and `handleAmendCommand`. In practice, having 6+ expense transactions of identical amount within a ±2-day window would be extraordinary; the cap is a safety valve only.

**Alternatives considered**:
- Paginated button views — rejected (over-engineering for a single-user tool)
- Text-based selection via modal — rejected (more friction; buttons match existing UX)

## Decision 6: Collision Guard at Link Time

**Decision**: Before writing the link, verify `transactions.matched_invoice_id IS NULL`. If already matched, reject the link and re-present the invoice with updated candidates (excluding the now-matched one).

**Rationale**: Between the time the sequential prompt was sent and the user clicked, another action (manual DB edit, concurrent bot invocation) could have matched the target transaction. Checking at write time prevents a silent overwrite of an existing match, consistent with FR-008.

**Alternatives considered**:
- Optimistic write, surface Supabase constraint error — rejected (error message would be cryptic; user-friendly rejection is required by FR-008)

## Decision 7: No New Discord Command Registration for Component Interactions

**Decision**: The `reconcile_link:*` and `reconcile_skip:*` custom_id prefixes are handled inside `handleComponentInteraction` in `discord.ts` — no new registered command needed for the button responses.

**Rationale**: All existing button interactions (fee_link, amend_select, etc.) follow this same pattern. Discord does not require separate command registration for MESSAGE_COMPONENT interactions.
