# Implementation Plan: Category Single Source of Truth (B2 Normalization)

**Branch**: `027-category-ssot-normalization` | **Date**: 2026-06-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/027-category-ssot-normalization/spec.md`

## Summary

Make the transaction-level category the single authoritative source: items store a category tag only as a deliberate override (or the explicit-uncategorized sentinel `其他:未分類`); inheriting items store nothing and derive their category at read time. The backend summary aggregation **already implements live inheritance** via its remainder logic (untagged items fall into the remainder, bucketed by the tx-level tag) — so the work is: (1) a shared write-normalization rule applied at every write path that currently copies the category onto items (PWA POST/PUT, item PATCH, Discord `/expense`, Android ingest), (2) the explicit-uncategorized sentinel + the two-action picker (繼承主分類 / 設為「其他」), (3) PWA surfaces deriving and showing the *effective* category, and (4) a one-off, dry-run-first normalization script for existing data with a built-in totals-equivalence verifier.

## Technical Context

**Language/Version**: TypeScript 5.x (backend strict; PWA `tsc -b`)
**Primary Dependencies**: Hono (CF Workers router), Supabase JS v2, React 18 + Vite (PWA), TanStack React Query
**Storage**: Supabase Postgres — `transactions.tags text[]`, `transaction_items.tags text[]` (no schema change; this feature changes tag *content conventions* only)
**Testing**: Vitest + `@cloudflare/vitest-pool-workers` (backend, 319 passing); PWA typecheck + build (no unit-test harness)
**Target Platform**: Cloudflare Workers (backend), Cloudflare Pages PWA (mobile-first), Discord webhook, Android companion (unchanged)
**Project Type**: Web service + PWA frontend (existing `backend/` + `pwa/` layout)
**Performance Goals**: No new hot-path work — write paths gain a pure array transform; reads unchanged
**Constraints**: CF free-tier CPU budget (Principle III); migration script runs **locally**, not in the Worker; live DB is the data SSOT (no seed migration files)
**Scale/Scope**: Single user; ~2–3k transactions to normalize; 4 backend write paths, 1 read service (unchanged), 5 PWA surfaces, 1 one-off script

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First** — No new components or abstractions: one pure helper added to the existing `item-category.ts` service, one one-off script following the established `scripts/migrate-legacy.ts` pattern. No schema change. Complexity Tracking is empty.
- [x] **II. Offline-First on Android** — Android app untouched; its ingest path is normalized **server-side** in the existing handler. Room/WorkManager flow unaffected.
- [x] **III. Serverless Boundary Compliance** — Write normalization is a synchronous pure array transform (microseconds). The data migration runs as a local script against Supabase, never inside the Worker. No new long operations.
- [x] **IV. Automation Over Manual Input** — Strengthened: re-categorizing a transaction becomes one action for all inheriting items; Discord `/expense` stays a single command (its category just lands at tx-level now).
- [x] **V. Security at System Boundaries** — The script loads `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` from env (dotenv), same as `migrate-legacy.ts`; no secrets in code or transcript. No new endpoints or auth surfaces.

*Post-design re-check (after Phase 1): still passing — design added no components beyond the helper + script.*

## Project Structure

### Documentation (this feature)

```text
specs/027-category-ssot-normalization/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output (incl. FR-014 picker mockup for sign-off)
├── contracts/
│   └── internal-api.md  # Phase 1 output — PATCH semantics extension
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── services/
│   │   ├── item-category.ts        # MODIFY: + EXPLICIT_UNCATEGORIZED sentinel, normalizeItemTagsOnWrite(),
│   │   │                           #   mergeItemCategoryTag() collapse rule
│   │   ├── summary.ts              # UNCHANGED (remainder logic already = live inheritance) — regression tests only
│   │   └── expense-parser.ts       # MODIFY: parseItems() stops copying sharedCategory onto items
│   ├── handlers/
│   │   ├── pwa.ts                  # MODIFY: POST L190 / PUT L520 item-tag copy → normalize; PATCH L575-599
│   │   │                           #   collapse + sentinel; refund-link L765 stops item copy (tx copy L755 stays)
│   │   ├── discord.ts              # MODIFY: L160 tx.tags gains sharedCategory; L166 items lose the copy
│   │   └── android.ts              # MODIFY: L179 items normalized against tx tags (unanimous-promote + strip)
│   └── scripts/  → backend/scripts/
│       └── normalize-category-ssot.ts  # NEW: one-off migration, dry-run default, totals-equivalence verifier
└── tests/
    ├── services/item-category.test.ts  # NEW: helper unit tests
    ├── services/summary.test.ts        # MODIFY: equivalence regressions (old shape vs normalized shape)
    └── handlers/                       # MODIFY: pwa POST/PUT/PATCH, discord, android write-shape assertions

pwa/
└── src/
    ├── lib/itemCategory.ts             # MODIFY: + EXPLICIT_UNCATEGORIZED, effectiveItemCategory(item, tx);
    │                                   #   isItemUncategorized treats sentinel as categorized
    ├── components/
    │   ├── ItemCategorySheet.tsx       # MODIFY: FR-014 — 繼承主分類 + 設為「其他」 rows replace single ✕ row
    │   ├── ItemRow.tsx                 # MODIFY: pass-through for new onSelect values; effective-category display
    │   └── EditExpenseSheet.tsx        # MODIFY: keep dual-source category read (FR-012); free-tag filtering as-is
    ├── screens/
    │   ├── EntryScreen.tsx             # MODIFY: item tag display via effectiveItemCategory
    │   ├── SummaryScreen.tsx           # MODIFY: L59/L70 item line shows effective category; sentinel renders 其他
    │   └── ImportScreen.tsx            # MODIFY: L275 local-state merge handles inherit/sentinel; L436 unchanged
    └── api/client.ts                   # UNCHANGED shape (assignItemCategory already takes string|null)
```

**Structure Decision**: Existing two-project layout (`backend/` + `pwa/`); no new directories beyond the one-off script file in the established `backend/scripts/`.

## Complexity Tracking

No constitution violations — table intentionally empty.

## Phase 0 → see [research.md](research.md)

All design unknowns resolved; no NEEDS CLARIFICATION markers remain. Key decisions: sentinel value `其他:未分類`; one shared write-normalization helper applied at all four backend write paths; migration as local dry-run-first script with a per-transaction total-preserving guard; `summary.ts` deliberately untouched.

## Phase 1 → [data-model.md](data-model.md) · [contracts/internal-api.md](contracts/internal-api.md) · [quickstart.md](quickstart.md)

## Implementation gate (user preference)

FR-014 changes shipped UI: present the picker mockup in quickstart.md §4 for Luke's sign-off **before** coding `ItemCategorySheet.tsx` changes.
