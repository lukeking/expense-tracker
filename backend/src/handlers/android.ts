import type { Context } from 'hono';
import type { Env, PaymentMethod, MobileWallet } from '../types';
import { getSupabaseClient } from '../db/client';
import { insertTransaction, findExistingTransaction, mergeTransactionFields, updateDiscordMessageId } from '../db/queries';
import { getBudgetProgress } from '../services/budget';
import { sendTransactionNotification } from '../services/discord-notify';

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

export async function healthHandler(c: Context<{ Bindings: Env }>) {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
}
