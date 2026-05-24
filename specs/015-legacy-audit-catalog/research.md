# Phase 0 Research: Legacy Data Audit Catalog

**Feature**: 015-legacy-audit-catalog | **Date**: 2026-05-23

Five design decisions resolved before implementation begins. Each section is a self-contained record: **Decision** / **Rationale** / **Alternatives considered**.

---

## 1. Diff storage: JSON sidecar vs markdown re-parse

**Decision**: Each run writes a pair of files with the same timestamp stem:
- `<ts>.md` — human-readable report
- `<ts>.json` — structured counts and metadata for the diff loader

The diff loader only ever reads `<ts>.json` files; it never parses the markdown.

**Rationale**:
- The markdown report is for humans (skimmed, scrolled, occasionally copy-pasted into Slack/discord). Adding "must remain regex-parseable" as a constraint on the renderer cripples future formatting changes (tables, callouts, emoji counts, etc.).
- A JSON sidecar costs one extra `fs.writeFile` per run and ~2 kB on disk per report (11 checks × small object). At one run per cleanup iteration this is negligible.
- Sidecar payload is trivially extended: adding fields (e.g. `samplePreviews`, `executionMs`) does not break the diff loader's contract.
- Reading a JSON file with `JSON.parse` is correct-or-throw; markdown parsing is a regex morass that silently mis-counts when formatting drifts.

**Alternatives considered**:
- *Parse counts out of the markdown report*: rejected — fragile, couples renderer and loader, and bug risk grows as the renderer evolves.
- *Single JSON-only output (no markdown)*: rejected — defeats the spec's "report markdown the owner skims" use case.
- *Append-only TSV log of all runs*: rejected — harder to read, harder to diff against a chosen prior run, no human-readable per-run artefact.

---

## 2. Sampling: Postgres `ORDER BY random()` vs alternatives

**Decision**: Each check's SQL uses `ORDER BY random() LIMIT 5` on the Postgres side to select 3–5 sample rows. No client-side reservoir sampling; no `TABLESAMPLE`.

**Rationale**:
- Satisfies FR-020 directly: the sample varies across runs (no bias toward newest/oldest), and includes `transaction_id` so the owner can drill in.
- Performance is irrelevant at 17 k rows: `ORDER BY random()` is O(n log n) over the candidate set, which is at most a few thousand rows per check. Sub-second per check, well within SC-006's 5-minute budget.
- Trivial in SQL — no Node-side shuffling code to write or test.

**Alternatives considered**:
- *`TABLESAMPLE BERNOULLI (n)`*: rejected — picks a random *block sample*, not a uniform random row sample; biased on small candidate sets and surprises the owner when sample contents look clustered.
- *Stable hash-based sampling (`ORDER BY md5(id::text || :salt)`)*: rejected — more code, only useful if reproducibility across runs were a requirement, which it explicitly is not (FR-020 *requires* variety).
- *Client-side reservoir sampling over the full filtered stream*: rejected — needs to pull all candidate rows over the wire just to throw most away; pointless when the DB can do it in one statement.

---

## 3. Report filename format

**Decision**: `<ISO-8601-UTC-with-colons-replaced-by-dashes>.md` — e.g. `2026-05-23T14-30-00Z.md` (and matching `.json` sidecar with the same stem).

**Rationale**:
- ISO 8601 sorts lexicographically by time, which means a plain `fs.readdirSync().sort()` returns reports in chronological order. The diff loader just picks the last entry strictly less than the current filename.
- Colons (`:`) are illegal in filenames on Windows and reserved-meaning on macOS; replacing with dashes keeps the script cross-platform even though the primary target is Linux/Mac.
- The `Z` suffix makes the UTC intent explicit so the owner doesn't mis-read filenames in their local timezone.

**Alternatives considered**:
- *Unix epoch milliseconds*: rejected — sorts correctly but is unreadable in `ls` output; the owner can't tell when a report was generated without converting.
- *Local timezone timestamp*: rejected — confusing across DST boundaries and ambiguous if the owner ever runs on a machine in a different timezone.
- *Sequential numbering (`report-001.md`, `report-002.md`)*: rejected — requires tracking state across runs, and the owner loses immediate "when was this taken" context.

---

## 4. Module layout: single file vs split modules

**Decision**: Single file `backend/scripts/audit-legacy.ts` for v1, sectioned by comment headers:

```text
// -- Imports / env --
// -- Types --
// -- Check helpers (shared SQL fragments) --
// -- Checks (one function per check, invariants first then samplers) --
// -- Runner (iterate REGISTRY, isolate errors) --
// -- Report renderer (markdown + JSON sidecar) --
// -- Diff loader --
// -- Main --
```

The CHECK registry is a single `const CHECKS: Check[] = [...]` array near the bottom. Refactor trigger: if the file exceeds ~600 LOC during future check additions, extract `checks.ts` and `report.ts` as siblings.

**Rationale**:
- Matches the existing convention (`migrate-legacy.ts` is also a single file).
- Constitution I (Simplicity-First) explicitly prefers fewer moving parts when in doubt.
- The "add a new check" workflow (one function + one array entry, per FR-018) is trivially served by a single file — the future implementor scrolls to the checks section, adds, scrolls to the registry, appends. No need to know about module boundaries.
- v1 estimate: ~400 LOC (11 checks × ~20 lines + ~150 lines of runner/render/diff/types/CLI). Well under refactor threshold.

**Alternatives considered**:
- *Split into `checks/`, `runner/`, `report/` subdirectories from the start*: rejected — over-engineered for a one-file-equivalent amount of logic. Constitution violation territory.
- *One file per check*: rejected — bookkeeping nightmare for an 11-function script.

---

## 5. CLI argument parsing: manual vs library

**Decision**: Hand-written `argv` walker matching the existing pattern in `migrate-legacy.ts` (which parses `--dry-run`, `--batch-size`, and a positional argument the same way). v1 has one flag (`--source <name>`); the parser is ~20 lines.

**Rationale**:
- No new dependency.
- Symmetric with the only other comparable script in the repo (`migrate-legacy.ts`) → future maintainers don't have to context-switch.
- `yargs` / `commander` would be over-equipment for a one-flag CLI.

**Alternatives considered**:
- *`yargs`*: rejected — bundles ~15 transitive dependencies, useful only when there are many flags / subcommands / autogenerated `--help`.
- *Node's built-in `parseArgs` (`util.parseArgs`)*: rejected — works fine but not used elsewhere in the repo; no benefit over the existing convention. Worth reconsidering in a future refactor if more scripts gain CLI flags.

---

## Decisions not made (and why)

- **No retry logic on transient Supabase errors** — script is local-only and read-only; if a connection drops, the owner re-runs. No data integrity concern.
- **No structured logging library** — `console.log` / `console.error` are enough for a one-off CLI tool; matches `migrate-legacy.ts`.
- **No progress bar** — reports complete in < 5 min; the owner can tolerate console silence (each check logs `[audit] running <name>...` start/end already gives enough signal).
- **No automatic cleanup on prior reports** — they're cheap (~kB each) and the owner may want to compare against arbitrary prior baselines later. Leave directory management to the owner.
