# Implementation Plan: Invoice Reconciliation Enhancements

**Branch**: `023-invoice-reconcile-enhancements` | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/023-invoice-reconcile-enhancements/spec.md`

## Summary

Three independent enhancements to the merged Invoice Import v2 feature (022), all
enrichment-only (never create/delete a transaction):

- **US1 (P1)** — A "mark as read" review queue for the 已配對發票 (linked) list: a per-card
  已讀 and a 全部標為已讀 bulk action hide acknowledged matches by default; a 顯示已讀 toggle
  reveals them (still un-linkable). Backed by a new `invoices.reviewed_at` column; also
  fixes the `GET /pwa/import/matched` N+1 by batching the transaction fetch.
- **US2 (P2)** — Discount-aware matching: the auto-matcher also compares an invoice's net
  amount against a transaction's *gross* (`amount` + recorded discount adjustments), so a
  discounted expense recorded with its discount auto-links to the full-price invoice.
- **US3 (P3)** — Per-item replace in manual link: a selected invoice line replaces a chosen
  existing item's **name only** (keeping its amount, effective amount, and tags).

## Technical Context

**Language/Version**: TypeScript (backend + PWA)
**Primary Dependencies**: Backend — Hono, `@supabase/supabase-js`, Vitest +
`@cloudflare/vitest-pool-workers`. PWA — React, Vite, TailwindCSS, TanStack Query.
**Storage**: Supabase (Postgres). One new migration: `022_invoice_reviewed_at.sql`
(US1 only; US2/US3 need no schema change — they reuse `transaction_adjustments` and the
existing `transaction_items.source_invoice_id`).
**Testing**: Vitest (logic-level + Workers pool), matching the repo's existing style.
**Target Platform**: Cloudflare Workers (backend), Cloudflare Pages (PWA).
**Project Type**: Web (CF Worker backend at `backend/`, React PWA at `pwa/`).
**Performance Goals**: Import screen opens in <1 s regardless of historical matched-invoice
count (SC-002) — achieved by the unread filter + batched candidate fetch.
**Constraints**: Enrichment-only invariant (SC-003: no transaction created or deleted);
CF Workers isolate limits (batch queries, avoid per-row N+1).
**Scale/Scope**: Single user; hundreds–thousands of invoices over time.

## Constitution Check

*GATE: passed (no violations).*

- [x] **I. Simplicity-First** — One nullable column, two small endpoints, reuse of existing
  match/link/provenance machinery. No new components or abstractions. The N+1 fix is a
  straight simplification.
- [x] **II. Offline-First on Android** — No Android changes; not affected.
- [x] **III. Serverless Boundary Compliance** — All operations are short Supabase reads/
  writes; the batched matched-list query and bounded ±2-day discount-aware candidate scan
  reduce per-isolate work. No WebSocket/gateway; no >3 s operations.
- [x] **IV. Automation Over Manual Input** — Discount-aware matching *increases* automatic
  matching (aligns with the principle); the review queue reduces manual review burden.
  Auto-link still fires only for unambiguous (single-candidate) cases.
- [x] **V. Security at System Boundaries** — All access via the CF Worker + Supabase
  service key server-side; the PWA uses the existing authorization header. No new secrets,
  no client-side DB access.

## Project Structure

### Documentation (this feature)

```text
specs/023-invoice-reconcile-enhancements/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (US2 window/confidence, US1/US3 mechanics)
├── data-model.md        # Phase 1 — invoices.reviewed_at + reused entities
├── quickstart.md        # Phase 1 — manual verification of the three stories
├── contracts/
│   ├── api.md           # endpoint contracts (mark-read, matched filter, manual-link replace)
│   └── schema-ddl.sql   # migration 022 DDL
└── checklists/requirements.md
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── db/queries.ts          # reviewed_at filter + mark-read; batched matched fetch;
│   │                          #   gross-aware candidate query; per-item rename
│   ├── handlers/pwa.ts        # GET /import/matched (unread filter), POST /import/mark-read,
│   │                          #   manual-link replace directive
│   └── services/invoice-matcher.ts  # discount-aware match in runImportPipeline
├── supabase/migrations/022_invoice_reviewed_at.sql
└── tests/                     # invoice-matcher / queries / pwa-import (Vitest, logic-level)

pwa/
└── src/
    ├── screens/ImportScreen.tsx          # 已讀 / 全部標為已讀 / 顯示已讀 toggle
    └── components/ManualLinkSheet.tsx    # per-item replace control
```

**Structure Decision**: Existing web layout (backend CF Worker + React PWA). No new
top-level directories; all changes extend files touched by feature 022.

## Complexity Tracking

> No constitution violations — no entries required.

## Phase Notes

- **Phase 0 (research.md)**: resolves the one deferred clarification (US2 match window +
  confidence) and pins the mechanics for each story.
- **Phase 1 (data-model.md, contracts/, quickstart.md)**: schema delta, endpoint contracts,
  manual verification script.
- **Phase 2 (tasks.md)**: produced by `/speckit-tasks`, grouped by user story (US1 → US3).
