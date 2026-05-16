# Implementation Plan: Legacy Accounting Data Migration

**Branch**: `010-migrate-legacy` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/010-migrate-legacy/spec.md`

## Summary

One-time local TypeScript script (`backend/scripts/migrate-legacy.ts`) that reads the NaggingMoney UTF-8 CSV, maps its 9-category taxonomy to the existing `category:subcategory` tag format, and batch-inserts ~15,200 historical expense/income records into Supabase. Supports `--dry-run` mode that writes a full preview to a timestamped file. Requires one new migration adding a `source` column to `transactions` for dedup and filtering.

## Technical Context

**Language/Version**: TypeScript (ESM, strict), same config as existing backend  
**Primary Dependencies**: `@supabase/supabase-js` (existing), `tsx` (existing dev dep), `dotenv` (existing dev dep)  
**Storage**: Supabase (PostgreSQL) — same instance as production backend  
**Testing**: Vitest (existing framework) — unit tests for parser and mapper  
**Target Platform**: Local developer machine (Node.js; not a CF Worker)  
**Project Type**: CLI script (one-off migration tool)  
**Performance Goals**: Full 17,000-row import in < 5 minutes; dry-run preview file in < 60 seconds  
**Constraints**: Batch size 100 to avoid Supabase connection limits; script runs against live production DB  
**Scale/Scope**: ~17,000 rows, single run; re-runnable safely via dedup

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

- [x] **I. Simplicity-First** — A single script file with no new services, no new libraries beyond what already exists. No abstractions added. The staging table was explicitly rejected in clarification Q1; `--dry-run` covers the review need.
- [x] **II. Offline-First on Android** — Not applicable. This feature has no Android component.
- [x] **III. Serverless Boundary Compliance** — Not applicable. This is a local Node.js script, not a CF Worker. No platform constraints apply.
- [x] **IV. Automation Over Manual Input** — The script automates importing 17,000 rows that would otherwise require manual entry. Consistent with the principle's goal of minimising cognitive overhead.
- [x] **V. Security at System Boundaries** — Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `backend/.env` (already gitignored). No new secrets introduced. Service role key never appears in script source.

All gates pass. No Complexity Tracking entries required.

## Project Structure

### Documentation (this feature)

```text
specs/010-migrate-legacy/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── contracts/           # Phase 1 output (CLI contract)
│   └── cli.md
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code

```text
backend/
├── scripts/
│   ├── register-commands.ts       # existing pattern
│   └── migrate-legacy.ts          # NEW: migration entry point
├── src/
│   ├── services/
│   │   └── legacy-csv-parser.ts   # NEW: CSV parsing + field mapping
│   └── (no changes to existing files)
├── supabase/
│   └── migrations/
│       └── 008_add_source_to_transactions.sql  # NEW: adds source column
└── (no other changes)

# Dry-run output (gitignored):
backend/scripts/dry-run-YYYYMMDD-HHMMSS.txt
```
