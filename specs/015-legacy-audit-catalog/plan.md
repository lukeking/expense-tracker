# Implementation Plan: Legacy Data Audit Catalog

**Branch**: `015-legacy-audit-catalog` | **Date**: 2026-05-23 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/015-legacy-audit-catalog/spec.md`

---

## Summary

A read-only `tsx` script under `backend/scripts/` that walks the Supabase database for known anomaly patterns left by the legacy CSV migration (spec 010) and writes a timestamped markdown report (plus a JSON sidecar for fast diffing) into `specs/015-legacy-audit-catalog/audit-reports/`. The report is the input to a manual cleanup loop: the owner reads it, picks the largest anomaly category, writes a bulk `tsx` fix or one-off SQL, then re-runs the audit and reads the diff section to confirm progress. The first version ships 6 invariant-violation checks plus 5 structural samplers; new pattern detectors are added later by appending one function to a registry.

---

## Technical Context

**Language/Version**: TypeScript via `tsx` (Node.js runtime), matches existing `backend/scripts/` conventions
**Primary Dependencies**: `@supabase/supabase-js` (existing), `dotenv` (existing) — no new dependencies added
**Storage**: Supabase (PostgreSQL) — read-only access to `transactions`, `transaction_items`, `categories`
**Testing**: Manual — the script's own report (and the diff against a prior run) is the verification artefact; mirrors `migrate-legacy.ts` testing convention
**Target Platform**: Local developer machine (script does not run in CF Worker; not subject to its CPU limits)
**Project Type**: One-off / iterative developer tool — CLI script, not a service
**Performance Goals**: < 5 min wall-clock against ~17 k rows (SC-006); per-check query latency dominated by Postgres, not by Node
**Constraints**:
- MUST be read-only — never issues `INSERT` / `UPDATE` / `DELETE` / DDL (FR-003)
- MUST tolerate per-check errors without aborting the whole run (FR-019)
- MUST produce reports that survive across runs without manual filename collisions (UTC timestamp prefix)
**Scale/Scope**: ~17 000 `transactions` rows + ~3 000–20 000 `transaction_items` rows (depending on legacy coverage); 11 checks in v1

---

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **I. Simplicity-First (Personal Tool)** — Single new script file under `backend/scripts/`, no new components, no abstractions beyond what's required to satisfy FR-018 (check-registry pattern). Reuses the dotenv + service-role pattern already established by `migrate-legacy.ts`.
- [x] **II. Offline-First on Android** — N/A. This is a backend developer tool; the Android app is not touched.
- [x] **III. Serverless Boundary Compliance** — N/A. The script runs on the developer's local machine, not on Cloudflare Workers. No CF Worker code is changed.
- [x] **IV. Automation Over Manual Input** — N/A in the user-input sense. The audit *automates* the discovery of data anomalies that would otherwise require manual SQL exploration, which aligns with the spirit of this principle.
- [x] **V. Security at System Boundaries** — `SUPABASE_SERVICE_ROLE_KEY` is loaded from `backend/.env` and never logged or written to any report. No new secrets introduced. Script is read-only, so even if the key were leaked locally the blast radius is identical to existing scripts.

*All gates pass; no Complexity Tracking entries required.*

---

## Project Structure

### Documentation (this feature)

```text
specs/015-legacy-audit-catalog/
├── spec.md                       # Feature specification (Phase −1)
├── plan.md                       # This file (Phase 0/1 output)
├── research.md                   # Phase 0 output — design decisions log
├── data-model.md                 # Phase 1 output — entity shapes
├── quickstart.md                 # Phase 1 output — dev runbook
├── contracts/
│   ├── check-function.md         # Phase 1 output — Check function signature contract
│   └── report-format.md          # Phase 1 output — markdown + JSON sidecar format
├── checklists/
│   └── requirements.md           # Spec quality checklist (from /speckit-specify)
├── audit-reports/                # Created at first run; populated by the script
│   ├── 2026-05-23T14-30-00Z.md   # Human-readable report
│   └── 2026-05-23T14-30-00Z.json # Structured counts sidecar (paired by filename stem)
└── tasks.md                      # Phase 2 output (created by /speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
backend/
├── scripts/
│   └── audit-legacy.ts           # NEW: single-file CLI entry, runner, checks, report renderer, diff loader
├── src/
│   └── (no changes)
└── supabase/migrations/
    └── (no new migrations — script is read-only)
```

**Structure Decision**: Single backend script. All logic lives in one file (`backend/scripts/audit-legacy.ts`), sectioned by comment headers (`// -- Types --`, `// -- Checks --`, `// -- Runner --`, `// -- Report --`, `// -- Main --`). This mirrors the existing `migrate-legacy.ts` convention. If the file grows beyond ~600 LOC during future check additions, factor `checks` into a `audit-legacy/checks.ts` module — but do not pre-split.

---

## Complexity Tracking

> No constitution violations — table left empty.

---

## Implementation Phases

### Phase 0: Research

*See [research.md](research.md) for the full decision log.*

Five design questions resolved before coding:

1. **Diff storage** — JSON sidecar paired with each `.md` report (vs parsing the markdown). Markdown is for humans, JSON is for the diff loader.
2. **Sampling strategy** — Postgres `ORDER BY random() LIMIT 5` per check. Cheap at 17 k rows, satisfies FR-020 (bias-free, varies across runs).
3. **Report filename format** — `<ISO-8601-UTC-with-colons-as-dashes>.md` (e.g. `2026-05-23T14-30-00Z.md`) so filenames sort lexicographically by time and are Windows-compatible.
4. **Module layout** — Single file in v1, sectioned by comments. Refactor threshold: ~600 LOC.
5. **CLI parsing** — Manual `argv` parsing (matching `migrate-legacy.ts`). Only one flag in v1 (`--source <name>`); no library needed.

### Phase 1: Design & Contracts

*See [data-model.md](data-model.md), [contracts/check-function.md](contracts/check-function.md), [contracts/report-format.md](contracts/report-format.md), [quickstart.md](quickstart.md).*

**Key Design Decisions**:

- **Check function signature** (formal contract in `contracts/check-function.md`):
  ```typescript
  type Check = (ctx: CheckContext) => Promise<CheckResult>;
  interface CheckContext { supabase: SupabaseClient; sourceFilter: string | null; }
  interface CheckResult {
    name: string;                     // Stable identifier, used as diff key
    description: string;              // One-line human summary
    kind: 'invariant' | 'sampler';    // Routes rendering (samplers always show 'inspect-only')
    count: number;
    samples: Record<string, unknown>[]; // 3–5 rows; each must include transaction_id
    suggestedTool: 'bulk' | 'case-by-case' | 'inspect-only';
  }
  ```
- **Check registry**: a single `const CHECKS: Check[] = [...]` array near the bottom of the script. Adding a check = one function + one array-entry append. Satisfies FR-018 / SC-004.
- **Error isolation** (FR-019): the runner wraps each `await check(ctx)` in a try/catch; on throw it substitutes a synthetic `CheckResult { name: <bestEffort>, count: -1, samples: [{ error: msg }], suggestedTool: 'inspect-only', description: 'ERROR: <msg>' }`.
- **Report file pair**:
  - `<ts>.md` — human-readable; the diff header + per-check sections (markdown).
  - `<ts>.json` — `{ generatedAt, sourceFilter, checks: { [name]: { count, kind, suggestedTool, description } } }`. The diff loader only ever reads JSON sidecars (never re-parses markdown).
- **Diff loader**: lists all `*.json` sidecars in the report dir, sorts lexicographically (works because filenames are ISO timestamps), picks the immediately-prior one, computes per-name delta. Handles `(new)` and `(removed)` per FR-007 / FR-008.
- **Sampling**: each check's SQL uses `ORDER BY random() LIMIT 5` at the Postgres side. For checks that need to scan a derived set (e.g. orphan parent ref), use a CTE — Postgres can still randomise efficiently at 17 k rows.

**Constitution Re-check (post-design)**: Still passes. Design introduces no new components; the single new file under `backend/scripts/` and the report directory are the entire footprint.

---

## Execution Order

```
1. Implement types + skeleton runner + main entry (CLI + env + supabase client)
2. Implement the 6 invariant checks (FR-009 through FR-014)
3. Implement the 5 structural samplers (FR-015)
4. Implement markdown report renderer + JSON sidecar writer
5. Implement diff loader (reads prior JSON sidecar, computes deltas)
6. Wire diff section into report renderer
7. Manual smoke run against live DB → eyeball first report → adjust sample SQL if any check is mis-targeted
8. Hand off: user runs the cleanup loop iteratively
```

---

## Known Follow-up Specs (out of scope for this feature)

- **016 (anticipated)**: `transaction_adjustments` table + migrate fee/refund from standalone transaction rows. After it lands, FR-011 / FR-012 in this spec need a follow-up to point at `transaction_adjustments` instead of `transactions.parent_transaction_id`.
- **017 (anticipated)**: PWA transaction edit screen + atomic edit endpoint — replaces the current "edit in Supabase dashboard" workflow.
- **018 (anticipated)**: `v_transactions_full` Postgres VIEW joining items + adjustments back into a single browseable row.
- **schema invariant enforcement**: CHECK constraints / triggers preventing the anomaly classes that this audit detects. Deferred until the audit + cleanup loop has run enough iterations that the canonical invariants are stable.
