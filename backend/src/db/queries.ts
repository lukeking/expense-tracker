import type { SupabaseClient } from '@supabase/supabase-js';
import type { Transaction, Receipt, BudgetSettings, TransactionItem, PaymentMethod, MobileWallet, TransactionType } from '../types';

export async function insertTransaction(
  supabase: SupabaseClient,
  data: {
    amount: number;
    items: TransactionItem[] | null;
    tags: string[];
    payment_method: PaymentMethod;
    wallet?: MobileWallet | null;
    bank_name?: string | null;
    note?: string | null;
    discord_message_id?: string | null;
    transaction_type?: TransactionType;
    parent_transaction_id?: string | null;
    transaction_at: string;
  }
): Promise<Transaction> {
  const { data: row, error } = await supabase
    .from('transactions')
    .insert(data)
    .select()
    .single();
  if (error) throw new Error(`insertTransaction: ${error.message}`);
  return row as Transaction;
}

export async function updateDiscordMessageId(
  supabase: SupabaseClient,
  transactionId: string,
  discordMessageId: string
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ discord_message_id: discordMessageId })
    .eq('id', transactionId);
  if (error) throw new Error(`updateDiscordMessageId: ${error.message}`);
}

export async function getMonthlySpend(
  supabase: SupabaseClient,
  year: number,
  month: number
): Promise<number> {
  const start = `${year}-${String(month).padStart(2, '0')}-01T00:00:00+00:00`;
  const end =
    month === 12
      ? `${year + 1}-01-01T00:00:00+00:00`
      : `${year}-${String(month + 1).padStart(2, '0')}-01T00:00:00+00:00`;

  const { data, error } = await supabase
    .from('transactions')
    .select('amount, transaction_type')
    .gte('transaction_at', start)
    .lt('transaction_at', end);

  if (error) throw new Error(`getMonthlySpend: ${error.message}`);
  return (data ?? []).reduce((sum, row) => {
    const amount = row.amount as number;
    return row.transaction_type === 'refund' ? sum - amount : sum + amount;
  }, 0);
}

export async function getBudgetSettings(supabase: SupabaseClient): Promise<BudgetSettings> {
  const { data, error } = await supabase
    .from('budget_settings')
    .select()
    .eq('id', 1)
    .single();
  if (error) throw new Error(`getBudgetSettings: ${error.message}`);
  return data as BudgetSettings;
}

export async function updateBudgetSettings(
  supabase: SupabaseClient,
  monthlyBudget: number
): Promise<void> {
  const { error } = await supabase
    .from('budget_settings')
    .update({ monthly_budget: monthlyBudget, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) throw new Error(`updateBudgetSettings: ${error.message}`);
}

export async function upsertReceipts(
  supabase: SupabaseClient,
  receipts: Omit<Receipt, 'id' | 'fetched_at' | 'created_at'>[]
): Promise<void> {
  if (receipts.length === 0) return;
  const { error } = await supabase
    .from('receipts')
    .upsert(receipts, { onConflict: 'invoice_number', ignoreDuplicates: true });
  if (error) throw new Error(`upsertReceipts: ${error.message}`);
}

export async function findMatchCandidates(
  supabase: SupabaseClient,
  amount: number,
  transactionAt: string
): Promise<Receipt[]> {
  const txDate = new Date(transactionAt);
  const windowStart = new Date(txDate.getTime() - 48 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const windowEnd = new Date(txDate.getTime() + 48 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from('receipts')
    .select('*')
    .eq('total_amount', amount)
    .gte('invoice_date', windowStart)
    .lte('invoice_date', windowEnd);

  if (error) throw new Error(`findMatchCandidates: ${error.message}`);
  return (data ?? []) as Receipt[];
}

export async function matchTransaction(
  supabase: SupabaseClient,
  transactionId: string,
  receiptId: string
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ is_matched: true, matched_receipt_id: receiptId })
    .eq('id', transactionId);
  if (error) throw new Error(`matchTransaction: ${error.message}`);
}

export async function getUnmatchedTransactions(supabase: SupabaseClient): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('is_matched', false);
  if (error) throw new Error(`getUnmatchedTransactions: ${error.message}`);
  return (data ?? []) as Transaction[];
}

export async function insertPendingMatch(
  supabase: SupabaseClient,
  transactionId: string,
  candidateIds: string[],
  discordMessageId?: string
): Promise<void> {
  const { error } = await supabase.from('pending_matches').insert({
    transaction_id: transactionId,
    candidate_ids: candidateIds,
    discord_message_id: discordMessageId ?? null,
  });
  if (error) throw new Error(`insertPendingMatch: ${error.message}`);
}

export async function resolvePendingMatch(
  supabase: SupabaseClient,
  transactionId: string
): Promise<void> {
  const { error } = await supabase
    .from('pending_matches')
    .update({ resolved: true })
    .eq('transaction_id', transactionId)
    .eq('resolved', false);
  if (error) throw new Error(`resolvePendingMatch: ${error.message}`);
}

export async function findParentCandidates(
  supabase: SupabaseClient,
  searchTerm: string,
  windowDays: number
): Promise<Pick<Transaction, 'id' | 'amount' | 'items' | 'note' | 'transaction_at'>[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('transactions')
    .select('id, amount, items, note, transaction_at')
    .eq('transaction_type', 'expense')
    .gte('transaction_at', since)
    .or(`items::text.ilike.%${searchTerm}%,note.ilike.%${searchTerm}%`)
    .order('transaction_at', { ascending: false })
    .limit(5);
  if (error) throw new Error(`findParentCandidates: ${error.message}`);
  return (data ?? []) as Pick<Transaction, 'id' | 'amount' | 'items' | 'note' | 'transaction_at'>[];
}

export async function updateParentTransactionId(
  supabase: SupabaseClient,
  transactionId: string,
  parentTransactionId: string
): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .update({ parent_transaction_id: parentTransactionId })
    .eq('id', transactionId);
  if (error) throw new Error(`updateParentTransactionId: ${error.message}`);
}

export async function findExistingTransaction(
  supabase: SupabaseClient,
  amount: number
): Promise<Transaction | null> {
  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('amount', amount)
    .gte('created_at', threeMinutesAgo)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`findExistingTransaction: ${error.message}`);
  return data && data.length > 0 ? (data[0] as Transaction) : null;
}

export async function mergeTransactionFields(
  supabase: SupabaseClient,
  transactionId: string,
  fields: { bank_name?: string | null; wallet?: MobileWallet | null }
): Promise<Transaction> {
  // Only update fields that are currently null in the DB
  const updates: Record<string, string | null> = {};
  if (fields.bank_name != null) updates.bank_name = fields.bank_name;
  if (fields.wallet != null) updates.wallet = fields.wallet;

  if (Object.keys(updates).length > 0) {
    const { error } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', transactionId)
      .is('bank_name', null); // only overwrite if still null (first writer wins per field)
    if (error) throw new Error(`mergeTransactionFields: ${error.message}`);
  }

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('id', transactionId)
    .single();
  if (error) throw new Error(`mergeTransactionFields fetch: ${error.message}`);
  return data as Transaction;
}
