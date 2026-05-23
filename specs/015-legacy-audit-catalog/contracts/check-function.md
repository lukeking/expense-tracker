# Contract: Check Function Signature

**Feature**: 015-legacy-audit-catalog | **Date**: 2026-05-23

This contract defines the function signature every audit check MUST implement. The runner relies on these guarantees; the report renderer and diff loader rely on them transitively.

---

## Function signature

```typescript
type Check = (ctx: CheckContext) => Promise<CheckResult>;

interface CheckContext {
  /** Service-role Supabase client. Checks MUST use it only for SELECT-style operations. */
  supabase: SupabaseClient;

  /**
   * When non-null, every query a check issues MUST filter `transactions.source = sourceFilter`
   * (for item-level checks: filter on the joined parent transaction's source).
   * When null, no source filtering is applied.
   */
  sourceFilter: string | null;
}

interface CheckResult {
  /**
   * Stable identifier. Format: '<kind>.<snake_case_topic>'.
   * Examples: 'invariant.transactions_without_items', 'sampler.transactions_by_source'.
   * MUST match /^[a-z][a-z0-9_.]*$/.
   * MUST be unique across the registered CHECKS array.
   * MUST NOT change once a check is shipped (it is the diff key — renaming breaks diff continuity).
   */
  name: string;

  /**
   * One-line human-readable summary. Rendered as a blockquote under the section title in the
   * markdown report. ~120 chars max for layout reasons; no hard cap enforced.
   */
  description: string;

  /**
   * Routes rendering and constrains suggestedTool:
   *   'invariant' — a definitive anomaly. suggestedTool MAY be 'bulk' or 'case-by-case'.
   *   'sampler'   — diagnostic data dump, no judgement attached. suggestedTool MUST be 'inspect-only'.
   */
  kind: 'invariant' | 'sampler';

  /**
   * Number of rows matching the check.
   *   For invariants: count of anomalous rows.
   *   For samplers:   total count of rows considered, regardless of how many samples were returned.
   *   -1 is reserved as the ERROR sentinel; checks themselves MUST NOT return -1.
   */
  count: number;

  /**
   * 3–5 rows for the renderer to display. Each row is an object whose keys become column headers
   * in the rendered markdown table.
   * REQUIRED key: `transaction_id` (string UUID) so the owner can drill in via Supabase.
   * For item-level checks: include both `transaction_id` AND `item_id`.
   * Renderer truncates silently if length > 5.
   */
  samples: Record<string, unknown>[];

  /**
   * Hint for the owner about how to clean this category up.
   *   'bulk'         — same SQL/script can fix all rows; tackle in batch.
   *   'case-by-case' — each row needs individual judgement.
   *   'inspect-only' — informational; no cleanup action implied.
   */
  suggestedTool: 'bulk' | 'case-by-case' | 'inspect-only';
}
```

---

## Behavioural contract

### What a check MUST do

- **Be pure-read**. A check MUST NOT issue any `INSERT`, `UPDATE`, `DELETE`, `UPSERT`, or DDL via the supabase client.
- **Apply `sourceFilter` when non-null**. Every SQL the check issues MUST scope to rows whose owning transaction has `source = sourceFilter`.
- **Return a `CheckResult` even when zero rows match**. Empty result = `{ count: 0, samples: [] }` — never throw, never omit.
- **Include `transaction_id` in every sample row**. (For item-level checks: also include `item_id`.)
- **Sort sample rows in stable-but-varying order**. The convention is Postgres `ORDER BY random() LIMIT 5`; this is enforced by convention, not by type.

### What the runner is responsible for (a check MUST NOT do these itself)

- Wrapping the check call in try/catch. The runner traps exceptions and synthesises an ERROR sentinel `CheckResult` (`count: -1`, `description: 'ERROR: <msg>'`). Checks SHOULD let errors propagate — do not swallow them locally.
- Asserting `name` uniqueness across registered checks (runner pre-flight).
- Asserting `kind === 'sampler' ⟹ suggestedTool === 'inspect-only'` (runner pre-flight before render).
- Writing the JSON sidecar / markdown report.

### What a check MAY do

- Issue multiple supabase queries (e.g. an existence-check followed by a fetch of samples). No strict query-count cap.
- Use Postgres RPC functions if needed. None currently exist for these checks; if a future check needs `JOIN` patterns awkward in PostgREST syntax, an RPC is acceptable — but document it in the check's leading comment.

---

## Naming conventions

| Kind        | Prefix       | Example                                            |
|-------------|--------------|----------------------------------------------------|
| Invariant   | `invariant.` | `invariant.transactions_without_items`             |
| Sampler     | `sampler.`   | `sampler.transactions_by_source`                   |
| (future) Meta | `meta.`    | `meta.script_version` (reserved; not used in v1)   |

Underscores within the topic portion; lowercase only; no consecutive dots.

---

## Versioning

The `CheckResult` shape is treated as **internal to this script** (not consumed by external systems), so it MAY evolve freely. The single binding constraint is the JSON sidecar payload (`AuditReportSidecar`), which the diff loader reads from prior runs. That payload has its own `schemaVersion: 1` field; bumping it requires a corresponding migration in the diff loader (skip or transform older sidecars). See `contracts/report-format.md`.

---

## Example minimal check

```typescript
const checkTransactionsWithoutItems: Check = async ({ supabase, sourceFilter }) => {
  let query = supabase
    .from('transactions')
    .select('id, amount, source, transaction_at, note', { count: 'exact', head: true })
    .not('id', 'in', `(${/* subquery: select transaction_id from transaction_items */ ''})`);

  if (sourceFilter) query = query.eq('source', sourceFilter);

  // (actual implementation will use an RPC or a join — sketch only)
  const { count, error } = await query;
  if (error) throw new Error(error.message);

  // Fetch up to 5 sample rows, random order
  const { data: samples } = await supabase.rpc('sample_transactions_without_items', {
    p_source_filter: sourceFilter,
    p_limit: 5,
  });

  return {
    name: 'invariant.transactions_without_items',
    description: 'Transactions that have zero corresponding transaction_items rows.',
    kind: 'invariant',
    count: count ?? 0,
    samples: samples ?? [],
    suggestedTool: 'bulk',
  };
};
```

(Note: this sketch elides the exact PostgREST/RPC approach — see implementation tasks for concrete SQL.)
