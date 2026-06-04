# Implementation Plan: Invoice Import v2 — Interactive Reconciliation

**Branch**: `022-invoice-import-v2` | **Date**: 2026-06-04 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/022-invoice-import-v2/spec.md`

## Summary

Rewrite the e-invoice CSV import as an **enrichment-only** pipeline. The current
v1 pipeline (`runImportPipeline`) auto-creates transactions, runs a forex pass,
and runs a reconciliation pass — all of which v2 removes (FR-005: MUST NOT create
transactions). v2 keeps dedup-by-invoice-number, auto-links invoices that have
exactly one exact-amount candidate within ±2 days (classified `exact` same-day /
`near` otherwise), holds invoices with ≥2 candidates as `ambiguous`, and — per the
forex decision below — surfaces ±5% near-amount candidates into the ambiguous list
when no exact candidate exists. Manual resolution moves from Discord to the PWA via
two new endpoints (list ambiguous + resolve). The Discord `/import` and `/reconcile`
commands are removed.

## Decisions carried in from clarification

1. **Single pipeline, remove Discord import.** The enrichment-only pipeline becomes
   the only one. The Discord `/import` and `/reconcile` commands and their handlers
   are deleted; `register-commands.ts` drops both command definitions.
2. **Forex kept as a candidate source, never auto-linked.** Primary match is exact
   net amount within ±2 days. When **0 exact candidates** exist, the invoice is held
   as `ambiguous` if any ±5% near-amount candidate exists, so the user can link it
   manually. Forex matches are never auto-linked (amount mismatch is inherently
   ambiguous — consistent with Constitution IV).

## Technical Context

**Language/Version**: TypeScript (backend: CF Workers via Hono; frontend: React 18 + Vite PWA)
**Primary Dependencies**: Hono (routing), `@supabase/supabase-js` (Postgres access), React Query, Tailwind CSS
**Storage**: Supabase (Postgres) — one small migration (add `match_confidence` to `invoices`; add 3 count columns to `import_runs`)
**Testing**: Vitest + `@cloudflare/vitest-pool-workers` (backend); no frontend test harness in repo
**Target Platform**: CF Workers (backend), PWA mobile-first (frontend)
**Project Type**: Web application (backend + frontend)
**Performance Goals**: Re-import of an already-imported CSV completes < 3 s (SC-002); 30-invoice full reconciliation < 5 min on mobile (SC-001)
**Constraints**: CF Worker wall-time — import does sequential Supabase calls batched at 100 invoices; v2 *reduces* per-invoice work (no Gemini calls, no reconciliation pass) vs v1. Max 1,000 invoices/import (existing `RowLimitError`).
**Scale/Scope**: Single user; monthly-or-less import cadence; ≤1,000 invoices/file.

## Constitution Check

- [x] **I. Simplicity-First** — Net **reduction** in code: removes forex auto-create,
  unmatched auto-create, the reconciliation pass, and the Discord import/reconcile
  commands. Two new PWA endpoints + one small frontend resolution UI. No new
  services, no new abstractions. Forex retention reuses the existing
  `findForexCandidateTransaction` query (widened to return an array).
- [x] **II. Offline-First on Android** — Android app untouched. N/A.
- [x] **III. Serverless Boundary Compliance** — No WebSockets/gateway. Import remains
  a synchronous request; v2 removes the per-invoice Gemini call and the reconciliation
  pass, so CPU/wall-time per import strictly decreases. Discord deferred-response
  constraint no longer relevant (Discord import removed).
- [x] **IV. Automation Over Manual Input** — Auto-links the unambiguous case (exactly
  one exact-amount candidate) with no user input; requires manual confirmation only
  for genuinely ambiguous cases (≥2 exact candidates, or forex near-amount). This is
  exactly what Principle IV mandates for receipt matching.
- [x] **V. Security at System Boundaries** — No new secrets. New endpoints live under
  the existing `pwaRouter` and follow its auth pattern. No Supabase credentials reach
  the client; all access via the Worker. Read/enrich only.

No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/022-invoice-import-v2/
├── plan.md              ← this file
├── research.md          ← Phase 0 — pipeline behavior diff, decisions
├── data-model.md        ← Phase 1 — schema delta + entity field reference
├── quickstart.md        ← Phase 1 — manual verification walkthrough
├── contracts/
│   ├── api.md           ← Phase 1 — import / ambiguous-list / resolve contracts
│   └── schema-ddl.sql   ← Phase 1 — migration 020 DDL
├── checklists/
│   └── requirements.md  ← pre-existing
└── tasks.md             ← Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/
├── supabase/migrations/
│   └── 020_invoice_match_confidence.sql   ← NEW: match_confidence + import_run counts
├── src/
│   ├── services/invoice-matcher.ts        ← REWRITE: enrichment-only pipeline; delete forex auto-create / unmatched auto-create / runReconciliationPass
│   ├── db/queries.ts                       ← edit: widen forex query to array; add linkInvoiceToTransaction; remove reconciliation-only queries
│   ├── handlers/pwa.ts                     ← edit /import response shape; add GET /import/ambiguous, POST /import/resolve
│   ├── handlers/discord.ts                 ← DELETE: import + reconcile commands, handlers, button dispatch
│   ├── types.ts                            ← add match_confidence, items-outcome, v2 summary types; prune dead types
│   └── ...
├── scripts/register-commands.ts            ← remove 'import' and 'reconcile' command defs
└── tests/
    ├── services/invoice-matcher.test.ts    ← REWRITE for v2 behavior
    ├── db/queries.test.ts                  ← update for changed/removed queries
    ├── handlers/discord.test.ts            ← remove import/reconcile cases
    └── handlers/pwa-import.test.ts         ← NEW: import shape, ambiguous list, resolve (keep/replace)

pwa/src/
├── screens/ImportScreen.tsx                ← v2 result shape; render resolution flow when ambiguous > 0
├── components/AmbiguousInvoiceCard.tsx     ← NEW: invoice + candidate radios + keep/replace toggle + confirm
└── api/client.ts                            ← (reuse apiFetch; no change expected)
```

**Structure Decision**: Existing two-part web layout (`backend/` CF Worker + `pwa/`
React app). No new top-level components. All backend changes are confined to the
invoice-matcher service, the pwa handler, the queries module, and the Discord handler
cleanup; all frontend changes to `ImportScreen` plus one new card component.

## Implementation Phases

### Phase A — Schema migration (migration 020)

`backend/supabase/migrations/020_invoice_match_confidence.sql`:

```sql
ALTER TABLE invoices
  ADD COLUMN match_confidence TEXT
    CHECK (match_confidence IN ('exact', 'near'));

ALTER TABLE import_runs
  ADD COLUMN matched_exact_count     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN matched_near_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN skipped_unmatched_count INTEGER NOT NULL DEFAULT 0;
```

The `invoices.match_status` CHECK constraint is left as-is — v2 simply stops
producing `auto_created` / `held_forex` / `parse_failed` as persisted invoice rows;
no constraint change needed. `match_confidence` is set only on `matched` invoices.

### Phase B — Backend queries (`db/queries.ts`)

- **Keep** `findMatchingExpenseTransaction` (exact amount, ±2 days, `matched_invoice_id IS NULL`, expense) — the exact-candidate finder.
- **Widen** `findForexCandidateTransaction` → `findForexCandidateTransactions` returning `Transaction[]` (drop `.limit(1)`); ±5% amount band, same window/filters. Used both at import time (≥1 → ambiguous) and by the ambiguous-list endpoint.
- **Add** `linkInvoiceToTransaction(supabase, invoiceId, txId, confidence)` — sets `match_status='matched'`, `match_confidence`, `matched_transaction_id`. (Replaces `resolveHeldInvoice` usage; `resolveHeldInvoice` is removed with the Discord flow.)
- **Remove** (now dead): `findExactMatchIncludingLinked`, `findAllHeldForexInvoices`, `resolveHeldInvoice`. Keep `findAllAmbiguousInvoices`, `findExistingInvoiceNumbers`, `insertInvoice`, `enrichTransaction`, `getTransactionItems`, `replaceTransactionItems`, `updateTransactionItemAmount`.

### Phase C — Enrichment-only pipeline (`services/invoice-matcher.ts`)

Replace `runImportPipeline` with the v2 algorithm; delete `runReconciliationPass`,
the forex auto-create branch, and the unmatched auto-create branch (and the
`parseExpenseText`/Gemini import).

```text
counters = { matchedExact, matchedNear, ambiguous, skippedUnmatched,
             skippedDuplicate, skippedVoided, skippedZero, matched: Detail[] }

dedup invoice_numbers → existing ⇒ skippedDuplicate++
for each non-duplicate invoice (batched 100):
  exact = findMatchingExpenseTransaction(net, date)
  if exact.length === 1:
     conf = sameCalendarDay(date, tx.transaction_at) ? 'exact' : 'near'
     inv  = insertInvoice(status='matched', confidence=conf, matchedTxId=tx.id)
     enrichTransaction(tx, {invoiceNumber, seller, taxId, invoiceId})
     outcome = populateItemsFromInvoice(tx)        // fill-if-empty | keep
     conf==='exact' ? matchedExact++ : matchedNear++
     matched.push({ seller, invoice_number, tx_date, tx_amount, confidence, items_outcome })
  elif exact.length >= 2:
     insertInvoice(status='ambiguous'); ambiguous++
  else:
     forex = findForexCandidateTransactions(net, date)
     if forex.length >= 1: insertInvoice(status='ambiguous'); ambiguous++
     else:                  skippedUnmatched++      // NOT persisted (FR-007)
return counters
```

**Items rule (FR-008/009)** — rewrite `populateItemsFromInvoice`:
- existing items count === 0 → insert positive-amount invoice items → outcome `filled`
- existing items present → leave unchanged → outcome `kept`
- (Delete the v1 count-matching/auto-replace heuristic. `replaced` happens only via the resolve endpoint's `replace_items` flag.)

**Persistence model** (drives dedup + retry semantics):
- `matched` and `ambiguous` invoices **are** persisted → deduped on re-import.
- `skippedUnmatched` invoices are **not** persisted (FR-007 "without creating any record") → re-tried on the next import once a matching transaction may exist.
- `skippedDuplicate` / `skippedVoided` / `skippedZero` remain counters as in v1.

### Phase D — PWA endpoints (`handlers/pwa.ts`)

1. **`POST /pwa/import`** (rewrite response): multipart upload unchanged; response is
   the v2 summary —
   ```jsonc
   {
     "filename": "...",
     "matched_exact": N, "matched_near": N, "ambiguous": N,
     "skipped_unmatched": N, "skipped_duplicate": N,
     "skipped_voided": N, "skipped_zero": N,
     "matched": [ { "seller_name", "invoice_number", "transaction_at",
                    "amount", "confidence", "items_outcome" } ]
   }
   ```
   Persist available counts to `import_runs` (now incl. the 3 new columns).

2. **`GET /pwa/import/ambiguous`** (new): for each `ambiguous` invoice (ordered by
   date), re-derive candidates live —
   `candidates = findMatchingExpenseTransaction(net, date)`; if empty,
   `candidates = findForexCandidateTransactions(net, date)`. Returns invoice header
   fields + `candidates: [{ id, transaction_at, amount, note, items }]`. Live
   re-derivation naturally excludes candidates that got linked since import
   (`matched_invoice_id IS NULL` filter).

3. **`POST /pwa/import/resolve`** (new, FR-011): body
   `{ invoice_id, transaction_id, replace_items }`. Validate invoice is `ambiguous`
   and tx exists & unlinked. Apply in this order (practical atomicity — invoice status
   flips **last**, so a mid-way failure leaves it `ambiguous` and re-runnable):
   1. `enrichTransaction(tx, …)`
   2. items: `replace_items` → `replaceTransactionItems(positive invoice items)` (outcome `replaced`); else `populateItemsFromInvoice` (fill-if-empty / keep)
   3. `linkInvoiceToTransaction(invoice, tx, confidence)` — confidence from date diff
   Returns the resolved invoice detail (same shape as a `matched[]` entry).

   *Atomicity note:* Supabase JS has no multi-statement transaction; for a
   single-user tool the ordered-writes-with-status-last approach is sufficient and
   avoids introducing a Postgres RPC (Simplicity-First). Documented as the chosen
   strategy rather than a true DB transaction.

### Phase E — Remove Discord import/reconcile

- `handlers/discord.ts`: delete the `import` and `reconcile` command dispatch
  branches; delete `handleImportCommand`, the import summary builder, the reconcile
  card builder, `handleReconcileCommand`, `handleReconcileLink`, `handleReconcileSkip`,
  and the `reconcile_link:` / `reconcile_skip:` button dispatch. Remove now-unused
  imports (`runImportPipeline` is now PWA-only via `pwa.ts`; CSV parser imports;
  `resolveHeldInvoice`).
- `scripts/register-commands.ts`: remove the `import` and `reconcile` command
  definitions. **Deploy step:** re-run `register-commands.ts` so Discord deregisters
  the two slash commands.
- `index.ts`: the help text referencing `/import` (line ~23) — update or remove.

### Phase F — Frontend (`ImportScreen.tsx` + `AmbiguousInvoiceCard.tsx`)

- `ImportScreen`: replace `ImportResult` with the v2 shape; rebuild `RESULT_ROWS`
  (已配對-同日 / 已配對-鄰近 / 模糊待處理 / 略過-未配對 / 略過-重複 / 略過-作廢 / 略過-零額).
  When `ambiguous > 0`, fetch `GET /pwa/import/ambiguous` and render an
  `AmbiguousInvoiceCard` per invoice.
- `AmbiguousInvoiceCard` (new): shows invoice seller/amount/date + candidate radio
  list (date, amount, note, existing items), a keep/replace-items toggle, and a
  確認 button → `POST /pwa/import/resolve`. On success, removes the card and updates
  the summary counts (ambiguous−1, matched+1).

### Phase G — Tests

- `tests/services/invoice-matcher.test.ts` — rewrite: dedup→skip; 1 exact same-day→`exact`; 1 exact ±2d→`near`; ≥2 exact→ambiguous; 0 exact + forex present→ambiguous; 0 exact + 0 forex→skipped_unmatched (no invoice row); items filled-when-empty / kept-when-present; **no transaction ever created** (assert tx count invariant — SC-003).
- `tests/handlers/pwa-import.test.ts` (new) — `/import` v2 response shape; `/import/ambiguous` returns candidates incl. forex source; `/import/resolve` keep vs replace items, confidence from date, invoice→matched.
- `tests/db/queries.test.ts` — update for `findForexCandidateTransactions` (array) + `linkInvoiceToTransaction`; drop removed-query cases.
- `tests/handlers/discord.test.ts` — remove import/reconcile cases.
- `tests/services/csv-parser.test.ts` — unchanged (parsing/grouping not modified).

## Complexity Tracking

No constitution violations — v2 is a net simplification. Table intentionally empty.
