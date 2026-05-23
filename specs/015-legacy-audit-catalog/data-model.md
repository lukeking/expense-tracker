# Data Model: Legacy Data Audit Catalog

**Feature**: 015-legacy-audit-catalog | **Date**: 2026-05-23

This feature introduces **no new database schema**. All entities described here are in-memory or on-disk artefacts produced by the audit script. The script is strictly read-only against the existing schema (`transactions`, `transaction_items`, `categories`).

---

## In-memory entities (TypeScript types)

### `CheckContext`

The runtime context passed to each check function.

```typescript
interface CheckContext {
  supabase: SupabaseClient;     // service-role client, scoped to read-only use
  sourceFilter: string | null;  // when set, every query filters transactions.source = sourceFilter
}
```

### `CheckResult`

The contract each check function returns.

```typescript
interface CheckResult {
  name: string;                            // stable identifier; used as diff key (e.g. "invariant.transactions_without_items")
  description: string;                     // one-line human summary, rendered under the section title
  kind: 'invariant' | 'sampler';           // routes rendering and forces suggestedTool='inspect-only' when 'sampler'
  count: number;                           // -1 reserved for ERROR sentinel
  samples: Record<string, unknown>[];      // 3–5 rows; each MUST include `transaction_id` (or `item_id` + `transaction_id` for item-level checks)
  suggestedTool: 'bulk' | 'case-by-case' | 'inspect-only';
}
```

**Invariants**:
- `name` MUST be stable across versions; renaming a check breaks diff continuity. Treat names as part of the public contract of each check.
- `samples.length` ≤ 5; renderer truncates without warning if longer.
- When `kind === 'sampler'`, `suggestedTool` MUST be `'inspect-only'` (samplers don't recommend fixes — they're for eyeballing).
- When the runner traps an error from a check, it synthesises a sentinel result with `count: -1`, `description: 'ERROR: <message>'`, `samples: []`, and `suggestedTool: 'inspect-only'`.

### `Check`

```typescript
type Check = (ctx: CheckContext) => Promise<CheckResult>;
```

A `Check` is a pure async function. The registry is a single array at the bottom of the script:

```typescript
const CHECKS: Check[] = [
  checkTransactionsWithoutItems,
  checkItemsSumMismatch,
  checkFeeRefundWithoutParent,
  checkOrphanParentReference,
  checkCategoryTagOnTransaction,
  checkOrphanCategoryTagOnItem,
  samplerTransactionsByShape,
  samplerTransactionsBySource,
  samplerLongestNotes,
  samplerLongestTagsArrays,
  samplerLongestItemNames,
];
```

---

## On-disk entities (report artefacts)

### `AuditReport` (markdown)

A single human-readable file written to `specs/015-legacy-audit-catalog/audit-reports/<ts>.md`. Its structure:

```markdown
# Audit Report — 2026-05-23T14-30-00Z

**Source filter**: (none) | <name>
**Total transactions scanned**: <N>
**Generated**: 2026-05-23 14:30:00 UTC

## Diff vs 2026-05-22T09-15-00Z

| Check | Prior | Current | Delta |
|-------|------:|--------:|------:|
| invariant.transactions_without_items | 4521 | 87 | -4434 |
| sampler.transactions_by_shape | (sampler) | (sampler) | — |
| invariant.something_new | — | 12 | (new) |
| invariant.something_removed | 30 | — | (removed) |

## Invariant Violations

### invariant.transactions_without_items

> Transactions that have zero corresponding transaction_items rows.

**Count**: 87 | **Suggested cleanup**: bulk

| transaction_id | amount | source | transaction_at | note |
|---|--:|---|---|---|
| 9f3b… | 250 | legacy_migration | 2024-03-11 | 7-11 牛奶 |
| (4 more) | | | | |

### invariant.items_sum_mismatch

> ...

## Structural Samplers

### sampler.transactions_by_shape

> ...
```

(Full layout is normative; see `contracts/report-format.md`.)

### `AuditReportSidecar` (JSON)

A machine-readable file paired with each markdown report by stem (`<ts>.json`). Used by the diff loader on the *next* run.

```typescript
interface AuditReportSidecar {
  schemaVersion: 1;                  // bump if the structure changes incompatibly
  generatedAt: string;               // ISO-8601 UTC, same as filename
  sourceFilter: string | null;
  totalTransactionsScanned: number;
  checks: Record<string, {
    count: number;                   // -1 for ERROR
    kind: 'invariant' | 'sampler';
    suggestedTool: 'bulk' | 'case-by-case' | 'inspect-only';
    description: string;
    errored: boolean;                // true iff this check trapped an error
  }>;
}
```

**Why not also store samples in the sidecar?** Samples are large, varying, and unnecessary for diffing. The markdown is authoritative for samples; the sidecar is authoritative for counts.

---

## Relationships diagram

```text
CLI invocation
   │
   ├── reads:   process.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
   ├── reads:   argv (--source <name>)
   │
   ▼
Runner
   │
   ├── reads:   prior <ts>.json sidecar (if any) — for diff
   ├── reads:   transactions, transaction_items, categories (via supabase)
   │
   ▼
[ CheckResult, ... ]
   │
   ▼
Report renderer
   │
   ├── writes:  <ts>.md   (human report, includes diff section)
   └── writes:  <ts>.json (sidecar — counts only)
```

---

## State transitions

There are none. The script is stateless across runs; "state" is the set of files in the audit-reports directory, which is monotonically growing.

A run never modifies a prior report. Diff is computed by reading and is purely advisory.

---

## Validation rules (enforced in the script)

| Rule | Enforced where |
|---|---|
| `samples.length` ≤ 5 | Report renderer (truncates) |
| Every sample has `transaction_id` | Each check (responsibility of check author; unenforced at type level — relied on in renderer) |
| `kind === 'sampler'` ⟹ `suggestedTool === 'inspect-only'` | Asserted in runner before rendering |
| `name` is unique within `CHECKS` | Asserted in runner at start; throws before any DB query |
| `name` matches `/^[a-z][a-z0-9_.]*$/` | Asserted in runner at start (so diff-loader filename safety isn't a concern even if names ever become path components later) |
| Source-filter value when supplied is a known source (`legacy_migration`, `discord`, `pwa`, `invoice`, `android`, …) | Warned, not rejected — unknown values still flow through and result in zero matches, which is informative on its own |

---

## Out of scope (deferred to follow-up specs)

- `transaction_adjustments` table — FR-011 / FR-012 will need an update once it lands.
- Schema-level invariant enforcement (CHECK constraints, triggers) — separate spec once cleanup is mature.
- Generation of the `categories` lookup needed by FR-014 — already in place via spec 014's `012_legacy_categories.sql`.
