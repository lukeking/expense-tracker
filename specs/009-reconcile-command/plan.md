# Implementation Plan: Standalone Invoice Reconciliation Command

**Branch**: `009-reconcile-command` | **Date**: 2026-05-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/009-reconcile-command/spec.md`

## Summary

Add a `/reconcile` Discord slash command that triggers the existing invoice reconciliation
pass (currently only runs after `/import`) on demand, without requiring a CSV re-upload.
The command also extends the reconciliation pass to handle `ambiguous` invoices: those with
exactly 1 remaining candidate are auto-linked; those with 2+ candidates are presented
sequentially for explicit user selection via Discord buttons. No schema changes required —
the feature builds entirely on existing DB functions, adding one new query and extending
one existing service function.

## Technical Context

**Language/Version**: TypeScript (ESM), Wrangler 4.x compatibility target 2024-06-20
**Primary Dependencies**: Hono 4.x (routing), @supabase/supabase-js 2.x (DB), @noble/ed25519 2.x (Discord verification)
**Storage**: Supabase (PostgreSQL) — `invoices` and `transactions` tables; no schema changes
**Testing**: Vitest + @cloudflare/vitest-pool-workers (Miniflare runtime)
**Target Platform**: Cloudflare Workers (serverless, nodejs_compat)
**Project Type**: Serverless web service / Discord bot
**Performance Goals**: Immediate deferred acknowledgment within 3 seconds; full pass completes asynchronously via `ctx.waitUntil()`
**Constraints**: CF Workers 30-second CPU wall-time (mitigated by deferred async pattern); 128 MB memory per isolate
**Scale/Scope**: Single-user tool; held invoice count expected to be O(tens), not hundreds

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First** — No new services, libraries, or project components. Adds one
  new Discord command, one new DB query function, and extends one existing service function.
  No abstractions introduced beyond what the task requires. Single command covers all three
  user stories — no subcommands needed.
- [x] **II. Offline-First on Android** — N/A. This feature is backend/Discord-only; no
  Android code touched.
- [x] **III. Serverless Boundary Compliance** — `/reconcile` uses `type: 5` deferred
  response + `ctx.waitUntil()` for the full pass, consistent with all other slow handlers
  (`/expense`, `/summary`, `/import`). No WebSocket or gateway connections.
- [x] **IV. Automation Over Manual Input** — Single no-args Discord command. Sequential
  ambiguous resolution is the minimum interaction required when genuine user judgement is
  needed (2+ candidates). Auto-links unambiguous cases (1 candidate) without user input.
- [x] **V. Security at System Boundaries** — Same Discord ed25519 signature verification
  middleware applies to all interactions including `/reconcile` and its button callbacks.
  No new secrets required. Supabase access remains CF Worker-only.

*No violations. Complexity Tracking not required.*

## Project Structure

### Documentation (this feature)

```text
specs/009-reconcile-command/
├── plan.md              # This file
├── research.md          # Phase 0 decisions
├── data-model.md        # Entity analysis and new query functions
├── quickstart.md        # Verification guide
├── contracts/
│   └── discord-reconcile.md   # Discord command + component interaction contract
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code Changes (repository root)

```text
backend/
├── src/
│   ├── services/
│   │   └── invoice-matcher.ts     # extend runReconciliationPass for ambiguous invoices
│   ├── db/
│   │   └── queries.ts             # add findAllAmbiguousInvoices
│   └── handlers/
│       └── discord.ts             # add handleReconcileCommand + reconcile_link/skip handlers
├── scripts/
│   └── register-commands.ts       # add /reconcile command definition
└── tests/
    ├── services/
    │   └── invoice-matcher.test.ts  # extend with ambiguous reconciliation cases
    └── handlers/
        └── discord.test.ts          # add /reconcile and button interaction tests
```

**Structure Decision**: Extends the existing single-project backend layout. No new
directories or files outside existing test and source trees.

## Phase 0: Research Findings

All decisions documented in [research.md](research.md). Key findings:

1. **No subcommands** — single `/reconcile` covers all user stories; idempotent pass output serves as the held-invoice list view.
2. **Candidate IDs not persisted for `ambiguous` invoices** — must re-query `findMatchingExpenseTransaction` at reconcile time; this is correct behavior as the candidate set may have changed.
3. **Extend `runReconciliationPass`** — add a second loop for `ambiguous` invoices (1 candidate → auto-link, 0 candidates → auto-create, 2+ candidates → leave held for user).
4. **Button custom_id format** — `reconcile_link:{invoiceId}:{transactionId}` (87 chars, within 100-char limit); `reconcile_skip:{invoiceId}` (51 chars).
5. **5-button cap** — max 5 candidate buttons per message; most-recent-first if >5 (extraordinary edge case only).
6. **Collision guard at write time** — verify `matched_invoice_id IS NULL` before linking; re-present with refreshed candidates on collision.

## Phase 1: Design

### DB Layer — New Query (`queries.ts`)

**`findAllAmbiguousInvoices(supabase)`**
```
SELECT * FROM invoices WHERE match_status = 'ambiguous' ORDER BY invoice_date ASC
```
Returns `Invoice[]`. Parallel to existing `findAllHeldForexInvoices`.

Existing reused: `resolveHeldInvoice`, `enrichTransaction`, `findMatchingExpenseTransaction`,
`insertTransaction`.

### Service Layer — Extended Pass (`invoice-matcher.ts`)

`runReconciliationPass` signature change:
```typescript
// Before
export async function runReconciliationPass(supabase, env): Promise<number>

// After
export interface ReconciliationResult {
  forexResolved: number;
  ambiguousAutoResolved: number;
  ambiguousRemaining: Invoice[];
}
export async function runReconciliationPass(supabase, env): Promise<ReconciliationResult>
```

Callers updated:
- `runImportPipeline` in `invoice-matcher.ts` — destructure `forexResolved` from result; ignore `ambiguousRemaining` (import summary doesn't need sequential prompt)
- New `handleReconcileCommand` in `discord.ts` — uses full `ReconciliationResult`

New loop (appended after existing forex loop):
```
for each ambiguous invoice:
  candidates = findMatchingExpenseTransaction(net_amount, invoice_date)
  if candidates.length === 1:
    resolveHeldInvoice(id, candidates[0].id, 'matched')
    enrichTransaction(candidates[0].id, ...)
    ambiguousAutoResolved++
  elif candidates.length === 0:
    newTx = insertTransaction(...)   // Gemini tags, payment_method=cash
    resolveHeldInvoice(id, newTx.id, 'auto_created')
    enrichTransaction(newTx.id, ...)
    ambiguousAutoResolved++
  else:
    ambiguousRemaining.push(invoice)
```

### Handler Layer — New Command + Buttons (`discord.ts`)

**`handleReconcileCommand`** (type 2, name `reconcile`):
```
return { type: 5 }   // deferred
ctx.waitUntil(async () => {
  result = await runReconciliationPass(supabase, env)
  await patchInteractionMessage(env, token, formatReconcileSummary(result))
  for each invoice in result.ambiguousRemaining:
    candidates = await findMatchingExpenseTransaction(invoice.net_amount, invoice.invoice_date)
    await sendChannelMessage(env, formatAmbiguousPrompt(invoice, candidates))
})
```

**`reconcile_link:{invoiceId}:{transactionId}`** handler (type 3):
```
verify tx.matched_invoice_id IS NULL
  → success: resolveHeldInvoice + enrichTransaction → type:7 success + next prompt
  → collision: type:7 refreshed buttons (exclude conflicting tx)
  → all candidates gone: auto-create → type:7 auto-create notice + next prompt
```

**`reconcile_skip:{invoiceId}`** handler (type 3):
```
→ type:7 skip confirmation + next prompt (if any remain)
```

### Command Registration (`register-commands.ts`)

Append to `commands` array:
```json
{
  "name": "reconcile",
  "description": "重新比對所有待確認發票（外幣/模糊）"
}
```

### Sequential Prompt Delivery

The sequential ambiguous prompts are sent as new channel messages via `sendChannelMessage`
(existing function in `discord-notify.ts`), not as edits of the deferred response. This
keeps each invoice prompt as a distinct message with its own button set, consistent with
how `/summary` drilldown buttons are handled.

## Complexity Tracking

> No violations — table not required.
