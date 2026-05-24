# Contract: Audit Report Format

**Feature**: 015-legacy-audit-catalog | **Date**: 2026-05-23

Each audit run produces a **pair** of files in `specs/015-legacy-audit-catalog/audit-reports/`, sharing the same filename stem (an ISO-8601 UTC timestamp):

- `<stem>.md` — human-readable markdown report
- `<stem>.json` — machine-readable sidecar consumed by the diff loader on the *next* run

Both contracts are documented here. The markdown layout is normative for the renderer; the JSON shape is the public input contract for the diff loader.

---

## Filename stem

Format: `YYYY-MM-DDTHH-MM-SSZ`

- ISO 8601 UTC, with colons replaced by dashes (Windows/macOS filename compatibility).
- Always ends with `Z` to make the UTC intent unambiguous in `ls` output.
- Truncated to second precision (sub-second runs are not expected to be a concern).
- Example: `2026-05-23T14-30-00Z.md` / `2026-05-23T14-30-00Z.json`.

Filenames sort lexicographically by time, which lets the diff loader find the immediately-prior report with a plain `readdir().sort()`.

---

## Markdown report (`<stem>.md`)

### Top-level structure

```markdown
# Audit Report — <stem>

**Source filter**: <none|name>
**Total transactions scanned**: <N>
**Generated**: <YYYY-MM-DD HH:MM:SS UTC>

<DIFF_SECTION_OR_NOTHING>

## Invariant Violations

<INVARIANT_CHECK_SECTIONS>

## Structural Samplers

<SAMPLER_CHECK_SECTIONS>
```

### Diff section (omitted when no prior report exists, per FR-006)

```markdown
## Diff vs <prior-stem>

| Check                                          | Prior | Current |  Delta |
|------------------------------------------------|------:|--------:|-------:|
| invariant.transactions_without_items           |  4521 |      87 |  -4434 |
| invariant.items_sum_mismatch                   |   312 |     298 |    -14 |
| invariant.fee_refund_without_parent            |     0 |       0 |      0 |
| invariant.something_new_in_this_run            |     — |      12 |  (new) |
| invariant.something_removed_from_script        |    30 |       — | (removed) |
| sampler.transactions_by_shape                  | (sampler) | (sampler) | — |
```

Notes:
- Samplers appear in the diff table but show `(sampler)` / `—` instead of counts. The owner cares about deltas on invariants; sampler buckets shift naturally between runs.
- `(new)` and `(removed)` literal strings replace numeric values per FR-007 / FR-008.
- Delta is signed (`-` for reduction, `+` for increase, `0` for unchanged).

### Per-check section (invariant variant)

```markdown
### invariant.transactions_without_items

> Transactions that have zero corresponding transaction_items rows.

**Count**: 87 | **Suggested cleanup**: bulk

| transaction_id                       | amount | source           | transaction_at      | note          |
|--------------------------------------|-------:|------------------|---------------------|---------------|
| 9f3b1c4a-…-d8a2                      |    250 | legacy_migration | 2024-03-11T12:30:00 | 7-11 牛奶     |
| (4 more rows)                        |        |                  |                     |               |
```

### Per-check section (sampler variant)

```markdown
### sampler.transactions_by_source

> Distribution of transactions and per-source invariant violation counts.

**Total rows considered**: 17204 | **Suggested cleanup**: inspect-only

| source           | total | no_items | sum_mismatch | fee_no_parent | … |
|------------------|------:|---------:|-------------:|--------------:|---|
| legacy_migration | 15032 |     4498 |          287 |             0 | … |
| pwa              |  1840 |        0 |            8 |             0 | … |
| discord          |   289 |        0 |            5 |             0 | … |
| invoice          |    43 |        0 |            0 |             0 | … |
| (unknown)        |     0 |        0 |            0 |             0 | … |
```

The exact columns in a sampler section are sampler-specific — defined inside each sampler check, not by this contract.

### Per-check section (ERROR variant — when a check throws)

```markdown
### invariant.something_that_failed

> ERROR: connection refused while fetching candidates

**Count**: (errored) | **Suggested cleanup**: inspect-only

(Check raised an exception; see script output for the full stack trace.)
```

### Empty-DB / zero-match variant

When a check legitimately returns zero matches (and did not error), the section still renders. Per FR-004, this keeps diffs stable:

```markdown
### invariant.fee_refund_without_parent

> fee/refund transactions whose parent_transaction_id is NULL.

**Count**: 0 | **Suggested cleanup**: (no rows match this check)
```

---

## JSON sidecar (`<stem>.json`)

```typescript
interface AuditReportSidecar {
  /** Bump when this shape changes incompatibly. */
  schemaVersion: 1;

  /** ISO-8601 UTC, full precision (colons preserved here — only filenames replace them). */
  generatedAt: string;          // e.g. "2026-05-23T14:30:00.000Z"

  /** Same value as the active --source flag, or null. */
  sourceFilter: string | null;

  /** Count of transactions scanned after applying sourceFilter; informational only. */
  totalTransactionsScanned: number;

  /** Map from CheckResult.name to a slim snapshot. */
  checks: Record<string, {
    count: number;                                           // -1 for ERROR sentinel
    kind: 'invariant' | 'sampler';
    suggestedTool: 'bulk' | 'case-by-case' | 'inspect-only';
    description: string;
    errored: boolean;                                        // true iff this check trapped an error
  }>;
}
```

Example:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-23T14:30:00.000Z",
  "sourceFilter": null,
  "totalTransactionsScanned": 17204,
  "checks": {
    "invariant.transactions_without_items": {
      "count": 87,
      "kind": "invariant",
      "suggestedTool": "bulk",
      "description": "Transactions that have zero corresponding transaction_items rows.",
      "errored": false
    },
    "invariant.items_sum_mismatch": { "count": 298, "kind": "invariant", "suggestedTool": "case-by-case", "description": "…", "errored": false },
    "sampler.transactions_by_source": { "count": 17204, "kind": "sampler", "suggestedTool": "inspect-only", "description": "…", "errored": false }
  }
}
```

### Why samples are NOT in the sidecar

Sample rows are large, random, and irrelevant to diffing. The markdown is the single authoritative copy. The sidecar is a counts ledger; the markdown is the eyeballable artefact. Keeping them separated lets each evolve without polluting the other.

---

## Diff loader contract (informative — not a public contract, but documented for the implementor)

```typescript
async function loadPriorSidecar(reportsDir: string, currentStem: string): Promise<AuditReportSidecar | null>;
//   - List files matching /\.json$/ in reportsDir
//   - Filter out the file matching `${currentStem}.json` (current run)
//   - Sort remaining lexicographically (works because filenames are ISO timestamps)
//   - Pop the last entry — that's the immediately-prior sidecar
//   - If none exists, return null
//   - JSON.parse the file; validate `schemaVersion === 1` (warn and return null otherwise)
```

The diff renderer then walks the union of `currentChecks` and `priorSidecar.checks` and emits the table per the format above.

---

## Compatibility & evolution

- `schemaVersion: 1` is bumped only on incompatible sidecar changes. The diff loader MUST handle older versions gracefully (warn + skip diff, never crash).
- Adding new fields to a sidecar entry is backward-compatible at `schemaVersion: 1`; the diff loader ignores unknown fields.
- The markdown report layout is human-facing; the renderer MAY add prose sections (e.g. "Tips for cleanup"), reorder cosmetic elements, or change tables, without bumping any version — only the JSON sidecar is contract-bound.
