# Internal Contracts — Invoice Import Batching

## HTTP / API contract: UNCHANGED

No request or response shape changes (FR-010). All endpoints keep their current contracts:

- `POST /pwa/import` — same multipart request; same JSON summary (`matched_exact`, `matched_near`, `ambiguous`, `skipped_*`, `matched[]`, `skipped_unmatched_detail[]`).
- `GET /pwa/import/ambiguous` — same response shape (`{ ambiguous: [{ …, candidate_source, candidates: [{…, items}] }] }`); only its internal data-fetching is batched.

The PWA frontend requires no changes.

## New internal functions

### `backend/src/services/invoice-matcher.ts` (pure, no I/O)

```ts
// ±2-day window; amount == net OR amount + Σdiscount == net; excludes consumed.
export function selectExactDiscountCandidates(
  netAmount: number,
  invoiceDate: Date,
  candidates: Transaction[],
  discountByTxId: Map<string, number>,
  consumedTxIds: Set<string>,
): Transaction[];

// ±7-day window; floor(net*0.95)..ceil(net*1.05); excludes consumed.
export function selectForexCandidates(
  netAmount: number,
  invoiceDate: Date,
  candidates: Transaction[],
  consumedTxIds: Set<string>,
): Transaction[];
```

`runImportPipeline(supabase, invoices, importRunId, initialSkipped)` keeps its **signature and return type** (`PipelineCounters`); only its body changes.

### `backend/src/db/queries.ts` (bulk I/O)

```ts
// One query; expense + matched_invoice_id IS NULL + transaction_at in [start,end].
// Throws on truncation (returned rows > MAX_PAGE).
export async function fetchImportCandidateTransactions(
  supabase: SupabaseClient,
  windowStartISO: string,
  windowEndISO: string,
): Promise<Transaction[]>;

// One query; kind='discount' for the given tx ids; summed per transaction.
export async function fetchDiscountSumsByTransaction(
  supabase: SupabaseClient,
  txIds: string[],
): Promise<Map<string, number>>;

// One multi-row insert; returns inserted rows (with ids) in input order.
export async function bulkInsertInvoices(
  supabase: SupabaseClient,
  rows: InvoiceInsert[],
): Promise<Invoice[]>;

// One upsert (onConflict 'id'); full rows + enrichment fields.
export async function bulkEnrichTransactions(
  supabase: SupabaseClient,
  rows: TransactionEnrichmentRow[],
): Promise<void>;
```

Item fills reuse the existing `insertTransactionItems` shape via one multi-row insert (or a thin `bulkInsertTransactionItems` wrapper). `getTransactionItemsByTransactionIds` (existing) supplies the fill-vs-keep counts.

### Kept (still used by `GET /import/ambiguous` if that task is deferred)

`findMatchingExpenseTransaction`, `findForexCandidateTransactions` — retained. If the ambiguous endpoint is refactored (in scope), it pre-fetches once and calls the pure `select*Candidates` functions instead; the two DB functions may then be removed only if no caller remains.

## Constants

- `MAX_PAGE = 1000` — Supabase single-response row cap; candidate read requests `MAX_PAGE + 1` and aborts if exceeded (FR-012).
