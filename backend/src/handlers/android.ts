import type { Context } from 'hono';
import type { Env, PaymentMethod, MobileWallet, TransactionType, InputResponse, CandidateTransaction } from '../types';
import { getSupabaseClient } from '../db/client';
import { insertTransaction, findExistingTransaction, mergeTransactionFields, updateDiscordMessageId } from '../db/queries';
import { getBudgetProgress } from '../services/budget';
import { sendTransactionNotification } from '../services/discord-notify';
import { parseRawExpenseText } from '../services/gemini';

interface NotificationPayload {
  amount: number;
  bank_name?: string | null;
  payment_method: string;
  wallet?: string | null;
  notification_text: string;
  notified_at: string;
}

export async function androidNotificationHandler(c: Context<{ Bindings: Env }>) {
  let body: NotificationPayload;
  try {
    body = await c.req.json<NotificationPayload>();
  } catch {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'Invalid JSON body' }, 400);
  }

  const { amount, bank_name, payment_method, wallet, notification_text, notified_at } = body;

  const validPaymentMethods = ['credit_card', 'prepaid_wallet', 'easy_card', 'bank_account', 'cash'];
  const validWallets = ['line_pay', 'google_pay'];

  // Validate required fields
  if (!amount || !Number.isInteger(amount) || amount <= 0) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'amount must be a positive integer' }, 400);
  }
  if (!payment_method || !validPaymentMethods.includes(payment_method)) {
    return c.json(
      { error: 'INVALID_PAYLOAD', message: `payment_method must be one of: ${validPaymentMethods.join(', ')}` },
      400
    );
  }
  if (wallet != null && !validWallets.includes(wallet)) {
    return c.json({ error: 'INVALID_PAYLOAD', message: `wallet must be one of: ${validWallets.join(', ')}` }, 400);
  }
  if (wallet != null && !['credit_card', 'prepaid_wallet'].includes(payment_method)) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'wallet is only valid for credit_card or prepaid_wallet' }, 400);
  }
  if (!notified_at || isNaN(Date.parse(notified_at))) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'notified_at must be a valid ISO 8601 timestamp' }, 400);
  }
  if (!notification_text || typeof notification_text !== 'string') {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'notification_text is required' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  // Upsert: find existing transaction within 3-minute window by amount only
  const existing = await findExistingTransaction(supabase, amount);
  if (existing) {
    // Merge any new non-null fields (bank_name, wallet) into the existing transaction
    const merged = await mergeTransactionFields(supabase, existing.id, {
      bank_name: bank_name ?? null,
      wallet: wallet as MobileWallet | null,
    });
    return c.json(
      {
        transaction_id: merged.id,
        discord_message_id: merged.discord_message_id,
        merged: true,
      },
      200
    );
  }

  // Insert new transaction
  const transaction = await insertTransaction(supabase, {
    amount,
    items: null,
    tags: [],
    payment_method: payment_method as PaymentMethod,
    wallet: (wallet as MobileWallet) ?? null,
    bank_name: bank_name ?? null,
    note: notification_text,
    discord_message_id: null,
    transaction_at: notified_at,
  });

  // Send proactive Discord notification and store message ID
  try {
    const budgetProgress = await getBudgetProgress(supabase);
    const messageId = await sendTransactionNotification(c.env, transaction, budgetProgress);
    if (messageId) {
      await updateDiscordMessageId(supabase, transaction.id, messageId);
    }
  } catch (err) {
    console.error('Discord notification failed (non-fatal):', err);
  }

  return c.json(
    {
      transaction_id: transaction.id,
      discord_message_id: transaction.discord_message_id,
    },
    201
  );
}

export async function androidInputHandler(c: Context<{ Bindings: Env }>) {
  let body: { text?: string; parent_transaction_id?: string | null };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, message: 'Invalid JSON body' }, 400);
  }

  const { text, parent_transaction_id } = body;

  if (!text || typeof text !== 'string' || text.trim() === '') {
    return c.json({ success: false, message: 'text is required' }, 400);
  }
  if (text.trim().length > 500) {
    return c.json({ success: false, message: 'text must be 500 characters or fewer' }, 400);
  }

  const trimmed = text.trim();

  // Detect command type from prefix
  let transactionType: TransactionType = 'expense';
  let parseText = trimmed;
  if (/^fee\s+/i.test(trimmed)) {
    transactionType = 'fee';
    parseText = trimmed.replace(/^fee\s+/i, '');
  } else if (/^refund\s+/i.test(trimmed)) {
    transactionType = 'refund';
    parseText = trimmed.replace(/^refund\s+/i, '');
  }

  // wallet sub-type that Gemini doesn't distinguish
  let wallet: MobileWallet | null = null;
  if (/LINE Pay|LinePay/i.test(parseText)) {
    wallet = 'line_pay';
  } else if (/Google Pay|GooglePay/i.test(parseText)) {
    wallet = 'google_pay';
  }

  // Parse amount, items, tags, and payment_method via Gemini
  let parsed;
  try {
    parsed = await parseRawExpenseText(c.env, parseText);
  } catch {
    return c.json({ success: false, message: '解析失敗，請稍後再試。' }, 500);
  }

  if (!parsed.amount || parsed.amount <= 0) {
    return c.json(
      { success: false, message: '無法解析金額，請確認格式如：250 星巴克' },
      422
    );
  }

  const supabase = getSupabaseClient(c.env);

  // Dedup: same amount within 3 minutes
  const existing = await findExistingTransaction(supabase, parsed.amount);
  if (existing) {
    return c.json({ success: false, message: 'Duplicate detected — already recorded' }, 409);
  }

  const transaction = await insertTransaction(supabase, {
    amount: parsed.amount,
    items: parsed.items.map((i) => ({ name: i.name, amount: i.amount ?? 0 })),
    tags: parsed.tags,
    payment_method: parsed.payment_method,
    wallet,
    note: parseText,
    transaction_type: transactionType,
    parent_transaction_id: parent_transaction_id ?? null,
    transaction_at: new Date().toISOString(),
  });

  const budgetProgress = await getBudgetProgress(supabase);
  const itemsLabel =
    transaction.items && transaction.items.length > 0
      ? transaction.items.map((i) => i.name).join('、')
      : parseText;

  const response: InputResponse = {
    success: true,
    message: `記帳成功！NT$${transaction.amount} — ${itemsLabel}`,
    transaction_id: transaction.id,
    budget_summary: {
      total_spent: budgetProgress.current_spend,
      monthly_budget: budgetProgress.monthly_budget,
      remaining: budgetProgress.monthly_budget - budgetProgress.current_spend,
      percentage: budgetProgress.percentage,
    },
  };

  return c.json(response, 201);
}

export async function recentTransactionsHandler(c: Context<{ Bindings: Env }>) {
  const q = c.req.query('q') ?? '';
  const limitParam = parseInt(c.req.query('limit') ?? '20', 10);
  const limit = Math.min(Math.max(limitParam, 1), 50);

  const supabase = getSupabaseClient(c.env);

  let query = supabase
    .from('transactions')
    .select('id, amount, items, note, transaction_at, transaction_type')
    .eq('transaction_type', 'expense')
    .order('transaction_at', { ascending: false })
    .limit(limit);

  if (q.trim()) {
    // Search note field and items JSON text representation
    query = query.or(`note.ilike.%${q.trim()}%,items::text.ilike.%${q.trim()}%`);
  }

  const { data, error } = await query;
  if (error) {
    return c.json({ error: 'Failed to fetch transactions' }, 500);
  }

  const candidates: CandidateTransaction[] = (data ?? []).map((row) => {
    const items = row.items as { name: string; amount: number }[] | null;
    const description =
      items && items.length > 0 ? items.map((i: { name: string }) => i.name).join(' ') : (row.note ?? '');
    return {
      id: row.id as string,
      amount: row.amount as number,
      description,
      transaction_at: row.transaction_at as string,
      transaction_type: row.transaction_type as TransactionType,
    };
  });

  return c.json({ candidates });
}

export async function healthHandler(c: Context<{ Bindings: Env }>) {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
}
