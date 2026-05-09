import type { Context } from 'hono';
import type { Env, PaymentMethod } from '../types';
import { getSupabaseClient } from '../db/client';
import {
  insertTransaction,
  updateBudgetSettings,
  updateDiscordMessageId,
  getMonthlySpend,
  getBudgetSettings,
  matchTransaction,
  resolvePendingMatch,
  findParentCandidates,
  updateParentTransactionId,
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
    components?: { type: number; components?: { type: number; custom_id?: string; value?: string }[] }[];
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
    if (commandName === 'fee') {
      return handleFeeCommand(c, interaction);
    }
    if (commandName === 'refund') {
      return handleRefundCommand(c, interaction);
    }
  }

  // MESSAGE_COMPONENT (button click)
  if (interaction.type === 3) {
    return handleComponentInteraction(c, interaction);
  }

  // MODAL_SUBMIT
  if (interaction.type === 5) {
    return handleModalSubmit(c, interaction);
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
          payment_method: parsed.payment_method,
          items: parsed.items.map((i) => ({ name: i.name, amount: i.amount ?? 0 })),
          tags: parsed.tags,
          transaction_at: new Date().toISOString(),
          transaction_type: 'expense',
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

        const messageId = await patchInteractionMessage(c.env, token, content);
        if (messageId) {
          await updateDiscordMessageId(supabase, transaction.id, messageId);
        }
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

function formatButtonLabel(amount: number, transactionAt: string): string {
  const utc8 = new Date(new Date(transactionAt).getTime() + 8 * 60 * 60 * 1000);
  const mm = String(utc8.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(utc8.getUTCDate()).padStart(2, '0');
  const hh = String(utc8.getUTCHours()).padStart(2, '0');
  const min = String(utc8.getUTCMinutes()).padStart(2, '0');
  return `NT$${amount.toLocaleString()} · ${mm}/${dd} ${hh}:${min}`;
}

async function handleFeeOrRefundCommand(
  c: Context<{ Bindings: Env }>,
  interaction: DiscordInteraction,
  txType: 'fee' | 'refund'
) {
  const options = interaction.data?.options ?? [];
  const amount = options.find((o) => o.name === 'amount')?.value as number;
  const defaultDesc = txType === 'fee' ? '國外交易服務費' : '退款';
  const description = (options.find((o) => o.name === 'description')?.value as string) ?? defaultDesc;
  const parent = options.find((o) => o.name === 'parent')?.value as string | undefined;
  const paymentMethod: PaymentMethod =
    txType === 'fee'
      ? 'credit_card'
      : ((options.find((o) => o.name === 'payment_method')?.value as string) ?? 'cash') as PaymentMethod;

  if (!amount || amount <= 0) {
    return c.json({ type: 4, data: { content: '❌ 金額必須大於 0' } });
  }

  const supabase = getSupabaseClient(c.env);
  const token = interaction.token;
  const env = c.env;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const transaction = await insertTransaction(supabase, {
          amount,
          transaction_type: txType,
          payment_method: paymentMethod,
          items: [{ name: description, amount }],
          tags: [],
          note: description,
          parent_transaction_id: null,
          transaction_at: new Date().toISOString(),
        });

        if (parent) {
          const candidates = await findParentCandidates(supabase, parent, 90);
          if (candidates.length > 0) {
            const content = `💳 記錄暫存，請選擇母交易：\nNT$${amount.toLocaleString()} · ${description}`;
            const candidateButtons = candidates.map((row) => ({
              type: 2,
              style: 1,
              label: formatButtonLabel(row.amount, row.transaction_at),
              custom_id: `${txType}_link:${transaction.id}:${row.id}`,
            }));
            const components = [
              { type: 1, components: candidateButtons },
              {
                type: 1,
                components: [
                  {
                    type: 2,
                    style: 2,
                    label: '儲存（不連結）',
                    custom_id: `${txType}_unlink:${transaction.id}`,
                  },
                ],
              },
            ];
            const messageId = await patchInteractionMessage(env, token, content, components);
            if (messageId) {
              await updateDiscordMessageId(supabase, transaction.id, messageId);
            }
            return;
          }
          // No candidates found — offer retype or save unlinked
          const noMatchContent =
            `⚠️ 找不到「${parent}」相符的消費記錄\n` +
            `💰 NT$${amount.toLocaleString()} · ${description}`;
          const noMatchComponents = [
            {
              type: 1,
              components: [
                { type: 2, style: 1, label: '🔍 重新搜尋', custom_id: `${txType}_retype:${transaction.id}` },
                { type: 2, style: 2, label: '儲存（不連結）', custom_id: `${txType}_unlink:${transaction.id}` },
              ],
            },
          ];
          const messageId = await patchInteractionMessage(env, token, noMatchContent, noMatchComponents);
          if (messageId) {
            await updateDiscordMessageId(supabase, transaction.id, messageId);
          }
        } else {
          const budgetProgress = await getBudgetProgress(supabase);
          const content =
            `✅ 記帳成功（未連結）\n` +
            `💰 NT$${amount.toLocaleString()} · ${description}\n` +
            `📊 本月支出：$${budgetProgress.current_spend.toLocaleString()} / $${budgetProgress.monthly_budget.toLocaleString()} (${budgetProgress.percentage}%)`;
          const messageId = await patchInteractionMessage(env, token, content);
          if (messageId) {
            await updateDiscordMessageId(supabase, transaction.id, messageId);
          }
        }
      } catch (err) {
        console.error(`handle${txType}Command async error:`, err);
        await patchInteractionMessage(env, token, '❌ 記帳失敗，請稍後再試。');
      }
    })()
  );

  return c.json({ type: 5 });
}

async function handleFeeCommand(
  c: Context<{ Bindings: Env }>,
  interaction: DiscordInteraction
) {
  return handleFeeOrRefundCommand(c, interaction, 'fee');
}

async function handleRefundCommand(
  c: Context<{ Bindings: Env }>,
  interaction: DiscordInteraction
) {
  return handleFeeOrRefundCommand(c, interaction, 'refund');
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

  if (customId.startsWith('fee_link:') || customId.startsWith('refund_link:')) {
    const prefixLen = customId.startsWith('fee_link:') ? 'fee_link:'.length : 'refund_link:'.length;
    const rest = customId.slice(prefixLen);
    const colonIdx = rest.indexOf(':');
    if (colonIdx === -1) return c.json({ type: 4, data: { content: '❌ 無效的操作' } });
    const txId = rest.slice(0, colonIdx);
    const parentId = rest.slice(colonIdx + 1);
    if (!txId || !parentId) return c.json({ type: 4, data: { content: '❌ 無效的操作' } });

    const supabase = getSupabaseClient(c.env);
    try {
      await updateParentTransactionId(supabase, txId, parentId);
      const [budgetProgress, txResult, parentResult] = await Promise.all([
        getBudgetProgress(supabase),
        supabase.from('transactions').select('amount, note').eq('id', txId).single(),
        supabase.from('transactions').select('amount, items, note, transaction_at').eq('id', parentId).single(),
      ]);
      const isRefund = customId.startsWith('refund_link:');
      const tx = txResult.data;
      const parent = parentResult.data;
      const parentName = parent?.items?.[0]?.name ?? parent?.note ?? '?';
      const parentLabel = parent
        ? `NT$${parent.amount.toLocaleString()} · ${parentName} (${parent.transaction_at.slice(5, 10).replace('-', '/')})`
        : '已連結';
      const emoji = isRefund ? '💸' : '💳';
      const label = isRefund ? '退款已連結！' : '費用已連結！';
      const content =
        `✅ ${label}\n` +
        `${emoji} NT$${tx?.amount.toLocaleString() ?? '?'} · ${tx?.note ?? '?'}\n` +
        `🔗 已連結至：${parentLabel}\n` +
        `📊 本月支出：$${budgetProgress.current_spend.toLocaleString()} / $${budgetProgress.monthly_budget.toLocaleString()} (${budgetProgress.percentage}%)`;
      return c.json({ type: 7, data: { content, components: [] } });
    } catch (err) {
      console.error('fee/refund link error:', err);
      return c.json({ type: 4, data: { content: '❌ 連結失敗，請稍後再試。' } });
    }
  }

  if (customId.startsWith('fee_unlink:') || customId.startsWith('refund_unlink:')) {
    const prefixLen = customId.startsWith('fee_unlink:') ? 'fee_unlink:'.length : 'refund_unlink:'.length;
    const txId = customId.slice(prefixLen);
    if (!txId) return c.json({ type: 4, data: { content: '❌ 無效的操作' } });

    const supabase = getSupabaseClient(c.env);
    try {
      const budgetProgress = await getBudgetProgress(supabase);
      const isRefund = customId.startsWith('refund_unlink:');
      const label = isRefund ? '退款已儲存（未連結）' : '費用已儲存（未連結）';
      const content =
        `✅ ${label}\n` +
        `📊 本月支出：$${budgetProgress.current_spend.toLocaleString()} / $${budgetProgress.monthly_budget.toLocaleString()} (${budgetProgress.percentage}%)`;
      return c.json({ type: 7, data: { content, components: [] } });
    } catch (err) {
      console.error('fee/refund unlink error:', err);
      return c.json({ type: 4, data: { content: '❌ 操作失敗，請稍後再試。' } });
    }
  }

  if (customId.startsWith('fee_retype:') || customId.startsWith('refund_retype:')) {
    const txType = customId.startsWith('fee_retype:') ? 'fee' : 'refund';
    const txId = customId.slice(`${txType}_retype:`.length);
    if (!txId) return c.json({ type: 4, data: { content: '❌ 無效的操作' } });

    return c.json({
      type: 9, // MODAL
      data: {
        title: '重新搜尋母交易',
        custom_id: `${txType}_parent_search:${txId}`,
        components: [
          {
            type: 1,
            components: [
              {
                type: 4, // TEXT_INPUT
                custom_id: 'parent_term',
                style: 1, // SHORT
                label: '搜尋關鍵字',
                placeholder: '例：Google AI Pro',
                required: true,
              },
            ],
          },
        ],
      },
    });
  }

  return c.json({ type: 4, data: { content: '❌ 未知的操作' } });
}

async function handleModalSubmit(
  c: Context<{ Bindings: Env }>,
  interaction: DiscordInteraction
) {
  const customId = interaction.data?.custom_id ?? '';

  if (customId.startsWith('fee_parent_search:') || customId.startsWith('refund_parent_search:')) {
    const txType = customId.startsWith('fee_parent_search:') ? 'fee' : 'refund';
    const txId = customId.slice(`${txType}_parent_search:`.length);
    const searchTerm = interaction.data?.components?.[0]?.components?.[0]?.value ?? '';

    if (!txId || !searchTerm) {
      return c.json({ type: 4, data: { content: '❌ 無效的操作' } });
    }

    const supabase = getSupabaseClient(c.env);
    const token = interaction.token;
    const env = c.env;

    c.executionCtx.waitUntil(
      (async () => {
        try {
          const candidates = await findParentCandidates(supabase, searchTerm, 90);
          if (candidates.length > 0) {
            const content = `💳 請選擇母交易：`;
            const candidateButtons = candidates.map((row) => ({
              type: 2,
              style: 1,
              label: formatButtonLabel(row.amount, row.transaction_at),
              custom_id: `${txType}_link:${txId}:${row.id}`,
            }));
            const components = [
              { type: 1, components: candidateButtons },
              {
                type: 1,
                components: [
                  { type: 2, style: 2, label: '儲存（不連結）', custom_id: `${txType}_unlink:${txId}` },
                ],
              },
            ];
            await patchInteractionMessage(env, token, content, components);
          } else {
            const noMatchContent = `⚠️ 找不到「${searchTerm}」相符的消費記錄`;
            const noMatchComponents = [
              {
                type: 1,
                components: [
                  { type: 2, style: 1, label: '🔍 重新搜尋', custom_id: `${txType}_retype:${txId}` },
                  { type: 2, style: 2, label: '儲存（不連結）', custom_id: `${txType}_unlink:${txId}` },
                ],
              },
            ];
            await patchInteractionMessage(env, token, noMatchContent, noMatchComponents);
          }
        } catch (err) {
          console.error('handleModalSubmit error:', err);
          await patchInteractionMessage(env, token, '❌ 搜尋失敗，請稍後再試。');
        }
      })()
    );

    return c.json({ type: 6 }); // DEFERRED_UPDATE_MESSAGE — updates the "not found" message in place
  }

  return c.json({ type: 4, data: { content: '❌ 未知的操作' } });
}
