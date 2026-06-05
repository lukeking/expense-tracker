// Augment Hono's ContextVariableMap so c.get/c.set('rawBody') is typed on any Context.
declare module 'hono' {
  interface ContextVariableMap {
    rawBody: string;
  }
}

export type PaymentMethod = 'credit_card' | 'prepaid_wallet' | 'easy_card' | 'bank_account' | 'cash';
export type MobileWallet = 'line_pay' | 'google_pay';
export type TransactionType = 'expense' | 'refund' | 'fee';

export interface TransactionItem {
  name: string;
  amount: number;
}

export interface TransactionItemRow {
  id: string;
  transaction_id: string;
  name: string;
  amount: number | null;
  effective_amount: number | null;
  tags: string[];
  sort_order: number;
  created_at: string;
}

export interface TransactionAdjustment {
  id: string;
  transaction_id: string;
  kind: 'fee' | 'refund' | 'discount';
  amount: number;
  transaction_at: string;
  basis: string | null;
  basis_value: number | null;
  note: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface TransactionWithItems extends Transaction {
  transaction_items: TransactionItemRow[];
}

export interface Transaction {
  id: string;
  transaction_type: TransactionType;
  amount: number;
  tags: string[];
  payment_method: PaymentMethod;
  wallet: MobileWallet | null;
  bank_name: string | null;
  note: string | null;
  is_matched: boolean;
  matched_receipt_id: string | null;
  parent_transaction_id: string | null;
  discord_message_id: string | null;
  invoice_number: string | null;
  seller_name: string | null;
  seller_tax_id: string | null;
  matched_invoice_id: string | null;
  source: string | null;
  transaction_at: string;
  created_at: string;
}

export type InvoiceMatchStatus =
  | 'pending'
  | 'matched'
  | 'auto_created'
  | 'held_forex'
  | 'ambiguous'
  | 'skipped_duplicate'
  | 'skipped_voided'
  | 'skipped_zero'
  | 'parse_failed';

// Invoice Import v2 — `exact` requires same calendar day AND exact net amount;
// `near` is every other linked match (different day or different amount, incl. forex).
export type MatchConfidence = 'exact' | 'near';

// Result of items handling when an invoice is linked to a transaction.
export type ItemsOutcome = 'filled' | 'kept' | 'replaced';

export interface InvoiceItem {
  name: string;
  quantity: number;
  unit_price: number;
  amount: number;
}

export interface Invoice {
  id: string;
  import_run_id: string;
  invoice_number: string;
  seller_name: string | null;
  seller_tax_id: string | null;
  invoice_date: string;
  gross_amount: number;
  allowance: number;
  net_amount: number;
  items: InvoiceItem[] | null;
  invoice_status: 'active' | 'voided';
  match_status: InvoiceMatchStatus;
  match_confidence: MatchConfidence | null;
  matched_transaction_id: string | null;
  created_at: string;
}

export interface ImportRun {
  id: string;
  file_name: string | null;
  total_rows: number;
  matched_count: number;
  auto_created_count: number;
  skipped_duplicate_count: number;
  skipped_voided_count: number;
  skipped_zero_count: number;
  held_forex_count: number;
  ambiguous_count: number;
  forex_resolved_count: number;
  parse_failed_count: number;
  matched_exact_count: number;
  matched_near_count: number;
  skipped_unmatched_count: number;
  uploaded_at: string;
  created_at: string;
}

// ─── Invoice Import v2 response shapes ────────────────────────────────────────

// One row in the post-import / post-resolve "matched" list.
export interface MatchedInvoiceDetail {
  seller_name: string | null;
  invoice_number: string;
  transaction_at: string;
  amount: number;
  confidence: MatchConfidence;
  items_outcome: ItemsOutcome;
}

// One row in the post-import "skipped (unmatched)" list. These invoices are not
// persisted (FR-007), so this carries the full invoice payload — the client holds it
// and passes it back to POST /pwa/import/manual-link to persist + link on demand.
// `invoice_date` is ISO (ParsedInvoice uses a Date).
export interface UnmatchedInvoiceDetail {
  invoice_number: string;
  seller_name: string;
  seller_tax_id: string;
  invoice_date: string;
  gross_amount: number;
  allowance: number;
  net_amount: number;
  invoice_status: 'active' | 'voided';
  items: InvoiceItem[];
}

// POST /pwa/import response body.
export interface ImportSummary {
  filename: string | null;
  import_run_id: string;
  matched_exact: number;
  matched_near: number;
  ambiguous: number;
  skipped_unmatched: number;
  skipped_duplicate: number;
  skipped_voided: number;
  skipped_zero: number;
  matched: MatchedInvoiceDetail[];
  skipped_unmatched_detail: UnmatchedInvoiceDetail[];
}

// A candidate transaction shown for an ambiguous invoice.
export interface AmbiguousCandidate {
  id: string;
  transaction_at: string;
  amount: number;
  note: string | null;
  items: { name: string; amount: number | null }[];
}

// One entry in GET /pwa/import/ambiguous.
export interface AmbiguousInvoiceEntry {
  id: string;
  invoice_number: string;
  seller_name: string | null;
  invoice_date: string;
  net_amount: number;
  items: InvoiceItem[] | null;
  candidate_source: 'exact' | 'forex';
  candidates: AmbiguousCandidate[];
}

export interface RawInvoiceRow {
  '載具自訂名稱': string;
  '發票日期': string;
  '發票號碼': string;
  '發票金額': string;
  '發票狀態': string;
  '折讓': string;
  '賣方統一編號': string;
  '賣方名稱': string;
  '賣方地址': string;
  '買方統編': string;
  '消費明細_數量': string;
  '消費明細_單價': string;
  '消費明細_金額': string;
  '消費明細_品名': string;
}

export interface ParsedInvoice {
  invoice_number: string;
  seller_name: string;
  seller_tax_id: string;
  invoice_date: Date;
  gross_amount: number;
  allowance: number;
  net_amount: number;
  invoice_status: 'active' | 'voided';
  items: InvoiceItem[];
}

export interface ReceiptItem {
  name: string;
  count: number;
  unit_price: number;
  amount: number;
}

export interface Receipt {
  id: string;
  invoice_number: string;
  random_code: string;
  seller_name: string;
  seller_tax_id: string;
  total_amount: number;
  items: ReceiptItem[];
  invoice_date: string;
  carrier_type: string;
  raw_data: unknown;
  fetched_at: string;
  created_at: string;
}

export interface BudgetSettings {
  id: 1;
  monthly_budget: number;
  updated_at: string;
}

export interface BudgetProgress {
  current_spend: number;
  monthly_budget: number;
  percentage: number;
  year: number;
  month: number;
}

export interface BudgetSummary {
  total_spent: number;
  monthly_budget: number;
  remaining: number;
  percentage: number;
}

export type SummaryPeriod = 'month' | 'last-month' | '3months' | 'half-year' | 'year' | 'all';

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface SubcategoryTotal {
  subcategory: string;
  total: number;
}

export interface InputResponse {
  success: boolean;
  message: string;
  transaction_id?: string;
  budget_summary?: BudgetSummary;
}

export interface CandidateTransaction {
  id: string;
  amount: number;
  description: string;
  transaction_at: string;
  transaction_type: TransactionType;
}

export interface GeminiParseResult {
  amount: number;
  payment_method: PaymentMethod;
  items: { name: string; amount?: number; tags?: string[] }[];
  tags: string[];
}

export interface HonoVariables {
  rawBody: string;
}

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_BOT_TOKEN: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL_NAME: string;
  ANDROID_API_KEY: string;
  DISCORD_CHANNEL_ID: string;
  PWA_ORIGIN: string;
}
