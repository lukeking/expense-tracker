# Phase 1 Data Model: Local End-to-End Test Stack

**Feature**: 028-e2e-test-stack | **Date**: 2026-06-13

This feature adds **no new production tables**. It defines test-fixture data and the
reset contract over the *existing* schema (`backend/supabase/migrations/*`). Entities
below are fixtures and harness concepts, not new persistent models.

## Existing tables touched (read or reset)

| Table | Role in the suite | Reset behavior |
|-------|-------------------|----------------|
| `categories` | Reference catalog; read by the entry flow's picker | **Preserved** — seeded once by `supabase db reset` (migrations + `seed.sql`), never truncated |
| `transactions` | Written by add-expense; aggregated by summary | Truncated + baseline re-inserted **before each test** |
| `transaction_items` | Item rows of a transaction | Truncated (CASCADE) + baseline re-inserted |
| `transaction_adjustments` | Discount/fee/refund rows | Truncated (CASCADE) |
| `transaction_edit_history` | Edit audit rows | Truncated (CASCADE) |

> The exact truncate list is finalized in tasks; the rule is **truncate all transactional tables, preserve `categories`**.

## Fixture: Category catalog seed

- **Source of truth**: `backend/supabase/seed/categories.md` (snapshot of the live ~133-row catalog).
- **Generated artifact**: `backend/supabase/seed.sql` — one idempotent statement per row:
  `INSERT INTO categories (major, subcategory, sort_order) VALUES (…) ON CONFLICT (major, subcategory) DO NOTHING;`
  (matches the `uq_category UNIQUE NULLS NOT DISTINCT (major, subcategory)` constraint from migration 011).
- **Load point**: `supabase db reset` runs migrations 011/012 (initial subset) then `seed.sql` (full snapshot upserts on top).
- **Fields per row** (from the snapshot): `major` (text, required), `subcategory` (text, nullable), `sort_order` (int).

## Fixture: Baseline transactions (summary assertions)

A small, fixed, hand-authored set inserted by the reset helper before each test. Purpose: give the summary test deterministic expected aggregates (FR-006).

Shape (per the existing schema):

- **transaction**: `amount` (int, NTD), `transaction_type` (`expense`), `payment_method`, `tags` (array incl. a `major:subcategory` category tag), `note`, `transaction_at` (fixed timestamp within one known period).
- **transaction_items**: ≥1 item per transaction (`name`, `amount`, `tags`).

Constraints on the set:
- Spans **≥2 distinct categories** and a **single known month**, so both a category filter and a period view have non-trivial, predictable totals.
- Totals are obvious by inspection (small integer amounts) so the test's expected values are self-documenting.
- Small enough that per-test re-insertion stays sub-second.

Exact rows are authored in `e2e/fixtures/baseline.ts` during implementation; the data-model fixes only their shape and invariants.

## Harness concepts (not persisted)

- **Local stack**: the coordinated `supabase` (54321/54322), `wrangler dev` (8787), and Vite (5300) processes the suite runs against.
- **Test auth identity**: the literal key `e2e-test-key`, set as both backend `ANDROID_API_KEY` and browser `localStorage['expense_api_key']`, so `Authorization: Bearer` checks pass.
- **Seed baseline (per test)**: `categories` (full snapshot) + the baseline transaction set — the identical state every test starts from (FR-002).

## Invariants

- I1: `categories` content after any reset == the full `categories.md` snapshot (initial migration subset is a subset of it).
- I2: Transactional tables after a `beforeEach` reset == exactly the baseline transaction set (no residue from prior tests).
- I3: No row in any table references production data; all timestamps/ids are fixture-defined.
