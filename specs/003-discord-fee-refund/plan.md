# Implementation Plan: Discord Fee & Refund Commands

**Branch**: `main` | **Date**: 2026-05-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/003-discord-fee-refund/spec.md`

## Summary

Add `/fee` and `/refund` slash commands to the existing Discord bot. Each command takes an explicit `amount`, optional `description` (the transaction's own label, with smart defaults), and optional `parent` (search term for finding the parent expense). If `parent` is supplied the backend queries the last 90 days of expense-type transactions for a case-insensitive substring match and presents up to 5 candidates as Discord button components. The fee/refund row is inserted immediately (before buttons appear) so that ignoring the prompt never loses data — the transaction remains as a valid unlinked record. Button click updates `parent_transaction_id`. Also fixes a latent bug in `getMonthlySpend` which currently sums all amounts unconditionally; once refund rows exist it would overstate spend.

## Technical Context

**Language/Version**: TypeScript (CF Workers runtime, ES2022)
**Primary Dependencies**: Hono (routing), `@supabase/supabase-js` v2, existing `discord-notify.ts`, existing `queries.ts`
**Storage**: Supabase PostgreSQL — existing `transactions` table, no new tables
**Testing**: Vitest + `@cloudflare/vitest-pool-workers`
**Target Platform**: Cloudflare Workers
**Project Type**: Extension of existing personal Discord bot — two new slash commands + one bug fix
**Performance Goals**: Command confirmation < 10s (SC-001 from spec)
**Constraints**: CF Workers stateless — no in-memory state between command invocation and button click; Discord interaction token TTL 15 min; Discord button label max 80 chars; max 25 buttons per message; `custom_id` max 100 chars
**Scale/Scope**: Same single-user, ~50–100 transactions/month

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [X] **I. Simplicity-First** — No new files, no new services, no new dependencies. Two new handler functions added to the existing `discord.ts`. One new query function in `queries.ts`. One bug fix in the same file. No new abstractions.
- [X] **II. Offline-First on Android** — N/A. This feature is backend/Discord only.
- [X] **III. Serverless Boundary Compliance** — Both `/fee` and `/refund` use the existing deferred response pattern (type 5 immediate + `waitUntil` for DB insert + Gemini-free candidate query). Component interaction handler responds with type 4 (immediate) after a single fast DB update. No WebSockets, no gateway.
- [X] **IV. Automation Over Manual Input** — Commands are single-step: one invocation, optional `parent` search term, one button tap. No wizard. Defaults remove required typing for the most common fee label ("國外交易服務費") and refund label ("退款").
- [X] **V. Security at System Boundaries** — No new auth surface. Discord ed25519 verification middleware already in place. No new secrets required.

*Post-design re-check*: No violations introduced. All changes are additive within existing patterns.

## Project Structure

### Documentation (this feature)

```text
specs/003-discord-fee-refund/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── discord-fee-refund-commands.md   ✓ already written
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code

```text
backend/src/
├── db/
│   └── queries.ts          MODIFY — fix getMonthlySpend (add transaction_type to select,
│                                     subtract refund amounts); add findParentCandidates()
└── handlers/
    └── discord.ts          MODIFY — add handleFeeCommand(), handleRefundCommand();
                                      extend handleComponentInteraction() for
                                      fee_link:, fee_unlink:, refund_link:, refund_unlink:

backend/scripts/
└── register-commands.ts    MODIFY — add /fee and /refund command definitions
```

**Structure Decision**: All changes extend existing files. No new source files required.

## Complexity Tracking

> No constitution violations. One design note:

| Decision | Why Needed | Simpler Alternative Rejected Because |
|----------|------------|--------------------------------------|
| Insert fee/refund before showing candidate buttons | CF Workers are stateless — cannot hold parsed data in memory between command response and button click interaction | Encoding all fee data in `custom_id` hits the 100-char limit for anything beyond trivial descriptions |
