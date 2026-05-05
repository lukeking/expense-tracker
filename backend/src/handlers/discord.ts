import type { Context } from 'hono';
import type { Env } from '../types';
import { getSupabaseClient } from '../db/client';
import {
  insertTransaction,
  updateBudgetSettings,
  getMonthlySpend,
  getBudgetSettings,
  matchTransaction,
  resolvePendingMatch,
} from '../db/queries';
import { parseExpenseText } from '../services/gemini';
import { getBudgetProgress } from '../services/budget';
import { patchInteractionMessage, patchTransactionMatchedMessage } from '../services/discord-notify';

interface DiscordInteraction {
  type: number;
  id: string;
  token: string;
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    options?: { name: string; value: string | number }[];
  };
}

export async function discordHandler(c: Context<{ Bindings: Env }>) {
  const rawBody = c.get('rawBody') as string;
  const interaction = JSON.parse(rawBody) as DiscordInteraction;

  // PING
  if (interaction.type === 1) {
    return c.json({ type: 1 });
  }

  // APPLICATION_COMMAND
  if (interaction.type === 2) {
    const commandName = interaction.data?.name;

    if (commandName === 'expense') {
      return handleExpenseCommand(c, interaction);
    }
    if (commandName === 'budget') {
      return handleBudgetCommand(c, interaction);
    }
    if (commandName === 'summary') {
      return handleSummaryCommand(c, interaction);
    }
  }

  // MESSAGE_COMPONENT (button click)
  if (interaction.type === 3) {
    return handleComponentInteraction(c, interaction);
  }

  return c.json({ error: 'Unknown interaction type' }, 400);
}

async function handleExpenseCommand(
  c: Context<{ Bindings: Env }>,
  interaction: DiscordInteraction
) {
  const options = interaction.data?.options ?? [];
  const amount = options.find((o) => o.name === 'amount')?.value as number;
  const description = options.find((o) => o.name === 'description')?.value as string;

  if (!amount || amount <= 0) {
    return c.json({ type: 4, data: { content: '❌ 金額必須大於 0' } });
  }

  // Respond immediately with deferred type
  const supabase = getSupabaseClient(c.env);
  const token = interaction.token;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const [parsed, budgetProgress] = await Promise.all([
          parseExpenseText(c.env, amount, description ?? ''),
          getBudgetProgress(supabase),
        ]);

        const transaction = await insertTransaction(supabase, {
          amount,
          items: parsed.items.map((i) => ({ name: i.name, amount: i.amount ?? 0 })),
          tags: parsed.tags,
          payment_method: 'cash',
          transaction_at: new Date().toISOString(),
        });

        const updatedProgress = await getBudgetProgress(supabase);
        const itemsStr =
          transaction.items && transaction.items.length > 0
            ? transaction.items.map((i) => i.name).join('、')
            : description ?? '未知';

        const content =
          `✅ 記帳成功！\n` +
          `💰 金額：$${amount}\n` +
          `🏷️ 品項：${itemsStr}\n` +
          `📊 本月支出：$${updatedProgress.current_spend.toLocaleString()} / $${updatedProgress.monthly_budget.toLocaleString()} (${updatedProgress.percentage}%)`;

        await patchInteractionMessage(c.env, token, content);
      } catch (err) {
        console.error('handleExpenseCommand async error:', err);
        await patchInteractionMessage(c.env, token, '❌ 記帳失敗，請稍後再試。');
      }
    })()
  );

  return c.json({ type: 5 });
}

async function handleBudgetCommand(
  c: Context<{ Bindings: Env }>,
  interaction: DiscordInteraction
) {
  const options = interaction.data?.options ?? [];
  const amount = options.find((o) => o.name === 'amount')?.value as number;

  if (!amount || amount <= 0) {
    return c.json({ type: 4, data: { content: '❌ 預算金額必須大於 0' } });
  }

  const supabase = getSupabaseClient(c.env);
  await updateBudgetSettings(supabase, amount);

  return c.json({
    type: 4,
    data: { content: `✅ 月度預算已更新為 $${amount.toLocaleString()}` },
  });
}

async function handleSummaryCommand(
  c: Context<{ Bindings: Env }>,
  interaction: DiscordInteraction
) {
  const options = interaction.data?.options ?? [];
  const monthOption = options.find((o) => o.name === 'month')?.value as string | undefined;

  const token = interaction.token;
  const supabase = getSupabaseClient(c.env);

  c.executionCtx.waitUntil(
    (async () => {
      try {
        let year: number;
        let month: number;

        if (monthOption) {
          const [y, m] = monthOption.split('-').map(Number);
          year = y;
          month = m;
        } else {
          const now = new Date();
          year = now.getUTCFullYear();
          month = now.getUTCMonth() + 1;
        }

        const [totalSpend, budgetSettings] = await Promise.all([
          getMonthlySpend(supabase, year, month),
          getBudgetSettings(supabase),
        ]);

        const percentage = Math.round((totalSpend / budgetSettings.monthly_budget) * 100);
        const monthStr = `${year}年${month}月`;

        const content =
          `📊 ${monthStr} 支出摘要\n\n` +
          `總支出：$${totalSpend.toLocaleString()} / $${budgetSettings.monthly_budget.toLocaleString()} (${percentage}%)`;

        await patchInteractionMessage(c.env, token, content);
      } catch (err) {
        console.error('handleSummaryCommand async error:', err);
        await patchInteractionMessage(c.env, token, '❌ 無法取得摘要，請稍後再試。');
      }
    })()
  );

  return c.json({ type: 5 });
}

async function handleComponentInteraction(
  c: Context<{ Bindings: Env }>,
  interaction: DiscordInteraction
) {
  const customId = interaction.data?.custom_id ?? '';

  if (customId.startsWith('confirm_match:')) {
    const parts = customId.split(':');
    const transactionId = parts[1];
    const receiptId = parts[2];

    if (!transactionId || !receiptId) {
      return c.json({ type: 4, data: { content: '❌ 無效的確認操作' } });
    }

    const supabase = getSupabaseClient(c.env);

    try {
      await matchTransaction(supabase, transactionId, receiptId);
      await resolvePendingMatch(supabase, transactionId);

      // Fetch receipt for message
      const { data: receipt } = await supabase
        .from('receipts')
        .select('*')
        .eq('id', receiptId)
        .single();

      // Fetch transaction to patch Discord message
      const { data: transaction } = await supabase
        .from('transactions')
        .select('*')
        .eq('id', transactionId)
        .single();

      if (receipt && transaction) {
        await patchTransactionMatchedMessage(c.env, transaction, receipt);
      }

      const sellerName = receipt?.seller_name ?? '未知';
      const invoiceDate = receipt?.invoice_date ?? '';

      return c.json({
        type: 4,
        data: {
          content: `✅ 已確認匹配！發票：${sellerName} $${receipt?.total_amount ?? 0} (${invoiceDate})`,
        },
      });
    } catch (err) {
      console.error('handleComponentInteraction error:', err);
      return c.json({ type: 4, data: { content: '❌ 匹配確認失敗，請稍後再試。' } });
    }
  }

  return c.json({ type: 4, data: { content: '❌ 未知的操作' } });
}
