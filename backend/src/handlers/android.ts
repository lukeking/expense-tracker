import type { Context } from 'hono';
import type { Env, PaymentMethod } from '../types';
import { getSupabaseClient } from '../db/client';
import { insertTransaction, findDuplicateTransaction, updateDiscordMessageId } from '../db/queries';
import { getBudgetProgress } from '../services/budget';
import { sendTransactionNotification } from '../services/discord-notify';

interface NotificationPayload {
  amount: number;
  bank_name: string;
  payment_method: string;
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

  const { amount, bank_name, payment_method, notification_text, notified_at } = body;

  // Validate required fields
  if (!amount || !Number.isInteger(amount) || amount <= 0) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'amount must be a positive integer' }, 400);
  }
  if (!bank_name || typeof bank_name !== 'string') {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'bank_name is required' }, 400);
  }
  if (!payment_method || !['credit_card', 'mobile_pay', 'cash'].includes(payment_method)) {
    return c.json(
      { error: 'INVALID_PAYLOAD', message: 'payment_method must be credit_card, mobile_pay, or cash' },
      400
    );
  }
  if (!notified_at || isNaN(Date.parse(notified_at))) {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'notified_at must be a valid ISO 8601 timestamp' }, 400);
  }
  if (!notification_text || typeof notification_text !== 'string') {
    return c.json({ error: 'INVALID_PAYLOAD', message: 'notification_text is required' }, 400);
  }

  const supabase = getSupabaseClient(c.env);

  // Duplicate detection
  const duplicate = await findDuplicateTransaction(supabase, amount, payment_method, bank_name);
  if (duplicate) {
    return c.json(
      {
        error: 'DUPLICATE_NOTIFICATION',
        existing_transaction_id: duplicate.id,
        message: 'A transaction with the same amount was recorded within the last 5 minutes',
      },
      409
    );
  }

  // Insert transaction
  const transaction = await insertTransaction(supabase, {
    amount,
    items: null,
    tags: [],
    payment_method: payment_method as PaymentMethod,
    bank_name,
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
