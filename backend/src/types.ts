export type PaymentMethod = 'credit_card' | 'prepaid_wallet' | 'easy_card' | 'bank_account' | 'cash';
export type MobileWallet = 'line_pay' | 'google_pay';
export type TransactionType = 'expense' | 'refund' | 'fee';

export interface TransactionItem {
  name: string;
  amount: number;
}

export interface Transaction {
  id: string;
  transaction_type: TransactionType;
  amount: number;
  items: TransactionItem[] | null;
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
  transaction_at: string;
  created_at: string;
}

export type InvoiceMatchStatus =
  | 'pending'
  | 'matched'
  | 'auto_created'
  | 'held_forex'
  | 'skipped_duplicate'
  | 'skipped_voided'
  | 'skipped_zero'
  | 'parse_failed';

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
  forex_resolved_count: number;
  parse_failed_count: number;
  uploaded_at: string;
  created_at: string;
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
  items: { name: string; amount?: number }[];
  tags: string[];
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
  MOF_CARRIER_ID: string;
  MOF_VERIFICATION_CODE: string;
  MOF_API_KEY: string;
  DISCORD_CHANNEL_ID: string;
}
