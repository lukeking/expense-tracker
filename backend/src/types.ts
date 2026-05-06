export type PaymentMethod = 'credit_card' | 'prepaid_wallet' | 'easy_card' | 'bank_account' | 'cash';
export type MobileWallet = 'line_pay' | 'google_pay';

export interface TransactionItem {
  name: string;
  amount: number;
}

export interface Transaction {
  id: string;
  amount: number;
  items: TransactionItem[] | null;
  tags: string[];
  payment_method: PaymentMethod;
  wallet: MobileWallet | null;
  bank_name: string | null;
  note: string | null;
  is_matched: boolean;
  matched_receipt_id: string | null;
  discord_message_id: string | null;
  transaction_at: string;
  created_at: string;
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

export interface GeminiParseResult {
  amount: number;
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
  ANDROID_API_KEY: string;
  MOF_CARRIER_ID: string;
  MOF_VERIFICATION_CODE: string;
  MOF_API_KEY: string;
  DISCORD_CHANNEL_ID: string;
}
