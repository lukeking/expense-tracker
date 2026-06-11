import type { Context } from 'hono';
import type { Env, HonoVariables, PaymentMethod, SummaryPeriod } from '../types';
import { getSupabaseClient } from '../db/client';
import {
  insertTransaction,
  insertTransactionItems,
  updateBudgetSettings,
  updateDiscordMessageId,
  matchTransaction,
  resolvePendingMatch,
  findParentCandidates,
  updateParentTransactionId,
  amendTransactionAmount,
  getTransactionWithItems,
  updateTransactionItemAmount,
  getCategoryTotals,
  getSubcategoryTotals,
} from '../db/queries';
import { parseTags, parseItems } from '../services/expense-parser';
import { periodToDateRange, mergeOverflowCategories, buildCategoryEmbedFields, buildSubcategoryEmbedFields } from '../services/summary';
import { fetchPieChartUrl, fetchBarChartUrl } from '../services/chart';
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
    resolved?: {
      attachments?: Record<string, {
        id: string;
        filename: string;
        size: number;
        url: string;
        content_type?: string;
      }>;
    };
  };
}

export async function discordHandler(c: Context<{ Bindings: Env; Variables: HonoVariables }>) {
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
    if (commandName === 'amend') {
      return handleAmendCommand(c, interaction);
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

const PM_LABELS: Record<string, string> = {
  cash: '現金',
  credit_card: '信用卡',
  easy_card: '悠遊卡',
  prepaid_wallet: '行動支付',
  bank_account: '銀行轉帳',
};

const PERIOD_LABELS: Record<string, string> = {
  'month': '本月',
  'last-month': '上個月',
  '3months': '近3個月',
  'half-year': '近半年',
  'year': '近一年',
  'all': '全部',
};

function encodeCategory(category: string): string {
  const bytes = new TextEncoder().encode(category);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeCategory(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function handleExpenseCommand(
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  const options = interaction.data?.options ?? [];
  const amount = options.find((o) => o.name === 'amount')?.value as number;
  const tagsInput = options.find((o) => o.name === 'tags')?.value as string | undefined;
  const descriptionInput = options.find((o) => o.name === 'description')?.value as string | undefined;
  const note = (options.find((o) => o.name === 'note')?.value as string | undefined) || null;
  const paymentMethod = ((options.find((o) => o.name === 'payment_method')?.value as string) ?? 'cash') as PaymentMethod;

  if (!amount || amount <= 0) {
    return c.json({ type: 4, data: { content: '❌ 金額必須大於 0' } });
  }

  const parsedTags = parseTags(tagsInput);
  if (parsedTags.error) {
    return c.json({ type: 4, data: { content: `❌ ${parsedTags.error}` } });
  }

  const supabase = getSupabaseClient(c.env);
  const token = interaction.token;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const parsedItems = parseItems(descriptionInput, amount, parsedTags.sharedCategory);

        if (parsedItems.error) {
          await patchInteractionMessage(c.env, token, `❌ ${parsedItems.error}`);
          return;
        }

        const transaction = await insertTransaction(supabase, {
          amount,
          payment_method: paymentMethod,
          // B2: the shared category lives on the transaction (prepended, legacy
          // tags[0] convention); items inherit it instead of carrying copies.
          tags: parsedTags.sharedCategory
            ? [parsedTags.sharedCategory, ...parsedTags.plainTags]
            : parsedTags.plainTags,
          note,
          transaction_at: new Date().toISOString(),
          transaction_type: 'expense',
        });

        await insertTransactionItems(supabase, transaction.id, parsedItems.items.map((item) => ({
          name: item.name,
          amount: item.amount ?? null,
          tags: item.tags,
        })));

        const updatedProgress = await getBudgetProgress(supabase);
        const pmLabel = PM_LABELS[paymentMethod] ?? '現金';
        const noteStr = note ? ` · ${note}` : '';
        const allTagLabels = [
          ...parsedTags.plainTags.map((t) => `#${t}`),
          ...(parsedTags.sharedCategory ? [`#${parsedTags.sharedCategory}`] : []),
        ];
        const tagsDisplay = allTagLabels.length > 0 ? ` · ${allTagLabels.join(' ')}` : '';
        const firstLine = `✅ NT$${amount}${noteStr}${tagsDisplay} [${pmLabel}]`;
        const itemLines = parsedItems.items.map((i) => `  · ${i.name}${i.amount != null ? ` NT$${  i.amount}` : ''}`).join('\n');
        const budgetLine = `📊 本月支出：$${updatedProgress.current_spend.toLocaleString()} / $${updatedProgress.monthly_budget.toLocaleString()} (${updatedProgress.percentage}%)`;

        const content = [firstLine, itemLines, budgetLine, ...parsedItems.warnings]
          .filter(Boolean)
          .join('\n');

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
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
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
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  const options = interaction.data?.options ?? [];
  const period = ((options.find((o) => o.name === 'period')?.value as string) ?? 'month') as SummaryPeriod;

  const token = interaction.token;
  const supabase = getSupabaseClient(c.env);

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const { start, end } = periodToDateRange(period);
        const rawTotals = await getCategoryTotals(supabase, start, end);

        if (rawTotals.length === 0) {
          await patchInteractionMessage(c.env, token, '此期間無支出記錄');
          return;
        }

        const totals = mergeOverflowCategories(rawTotals);
        const [chartUrl] = await Promise.all([fetchPieChartUrl(totals)]);
        const periodLabel = PERIOD_LABELS[period] ?? period;
        const grandTotal = totals.reduce((s, t) => s + t.total, 0);
        const embed = {
          title: `📊 ${periodLabel} 支出分類`,
          fields: buildCategoryEmbedFields(totals),
          footer: { text: `💰 合計：NT$${grandTotal.toLocaleString()}` },
          color: 0x5865f2,
          ...(chartUrl ? { image: { url: chartUrl } } : {}),
        };

        const buttons = totals.map((t) => ({
          type: 2,
          style: 1,
          label: t.category,
          custom_id: `summary_drilldown:${encodeCategory(t.category)}:${period}`,
        }));
        const components = buttons.length > 0 ? [{ type: 1, components: buttons }] : [];

        await patchInteractionMessage(c.env, token, '', components, [embed]);
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
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
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
          tags: [],
          note: description,
          parent_transaction_id: null,
          transaction_at: new Date().toISOString(),
        });

        await insertTransactionItems(supabase, transaction.id, [{ name: description, amount, tags: [] }]);

        if (parent) {
          const candidates = await findParentCandidates(supabase, parent, 90, transaction.id);
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
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  return handleFeeOrRefundCommand(c, interaction, 'fee');
}

async function handleRefundCommand(
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  return handleFeeOrRefundCommand(c, interaction, 'refund');
}

async function handleComponentInteraction(
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
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
        supabase.from('transactions').select('amount, note, transaction_at, transaction_items(name)').eq('id', parentId).single(),
      ]);
      const isRefund = customId.startsWith('refund_link:');
      const tx = txResult.data;
      const parent = parentResult.data;
      const parentName = (parent?.transaction_items as { name: string }[] | null)?.[0]?.name ?? parent?.note ?? '?';
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

  if (customId.startsWith('amend_select:')) {
    return handleAmendSelect(c, interaction);
  }

  if (customId.startsWith('amend_retype:')) {
    return handleAmendRetype(c, interaction);
  }

  if (customId === 'amend_cancel') {
    c.executionCtx.waitUntil(patchInteractionMessage(c.env, interaction.token, '已取消。', []));
    return c.json({ type: 6 });
  }

  if (customId.startsWith('summary_drilldown:')) {
    return handleDrilldownInteraction(c, interaction);
  }

  return c.json({ type: 4, data: { content: '❌ 未知的操作' } });
}

async function handleModalSubmit(
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  const customId = interaction.data?.custom_id ?? '';

  if (customId.startsWith('amend_modal:')) {
    return handleAmendModalSubmit(c, interaction);
  }

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
          const candidates = await findParentCandidates(supabase, searchTerm, 90, txId);
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

// ─── Summary drilldown ───────────────────────────────────────────────────────

async function handleDrilldownInteraction(
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  const customId = interaction.data?.custom_id ?? '';
  // custom_id format: summary_drilldown:{b64cat}:{period}
  const parts = customId.split(':');
  const b64cat = parts[1];
  const period = parts[2] as SummaryPeriod;

  if (!b64cat || !period) {
    return c.json({ type: 4, data: { content: '❌ 無效的操作' } });
  }

  const category = decodeCategory(b64cat);
  const token = interaction.token;
  const supabase = getSupabaseClient(c.env);

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const { start, end } = periodToDateRange(period);
        const subtotals = await getSubcategoryTotals(supabase, start, end, category);

        if (subtotals.length === 0) {
          await patchInteractionMessage(c.env, token, '此分類在此期間無支出記錄');
          return;
        }
        const chartUrl = await fetchBarChartUrl(subtotals, category);
        const periodLabel = PERIOD_LABELS[period] ?? period;
        const grandTotal = subtotals.reduce((s, t) => s + t.total, 0);

        const embed = {
          title: `📊 ${category} — ${periodLabel} 子分類`,
          fields: buildSubcategoryEmbedFields(subtotals),
          footer: { text: `💰 小計：NT$${grandTotal.toLocaleString()}` },
          color: 0x5865f2,
          ...(chartUrl ? { image: { url: chartUrl } } : {}),
        };
        await patchInteractionMessage(c.env, token, '', [], [embed]);
      } catch (err) {
        console.error('handleDrilldownInteraction async error:', err);
        await patchInteractionMessage(c.env, token, '❌ 無法取得子分類，請稍後再試。');
      }
    })()
  );

  return c.json({ type: 5 });
}

// ─── /amend handlers ────────────────────────────────────────────────────────

async function handleAmendCommand(
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  const options = interaction.data?.options ?? [];
  const newAmount = options.find((o) => o.name === 'amount')?.value as number;
  const parent = options.find((o) => o.name === 'parent')?.value as string | undefined;

  if (!newAmount || newAmount <= 0) {
    return c.json({ type: 4, data: { content: '❌ 金額必須大於 0' } });
  }

  const supabase = getSupabaseClient(c.env);
  const token = interaction.token;
  const env = c.env;

  c.executionCtx.waitUntil(
    (async () => {
      try {
        if (parent) {
          const candidates = await findParentCandidates(supabase, parent, 90);
          if (candidates.length > 0) {
            const content = `🔍 找到以下交易，請選擇要修正的項目：`;
            const buttons = candidates.map((row) => {
              const label = formatButtonLabel(row.amount, row.transaction_at);
              return { type: 2, style: 1, label, custom_id: `amend_select:${newAmount}:${row.id}` };
            });
            const components: object[] = [{ type: 1, components: buttons }];
            if (candidates.length < 5) {
              components.push({
                type: 1,
                components: [
                  { type: 2, style: 2, label: '🔍 重新搜尋', custom_id: `amend_retype:${newAmount}` },
                  { type: 2, style: 4, label: '取消', custom_id: 'amend_cancel' },
                ],
              });
            }
            await patchInteractionMessage(env, token, content, components);
          } else {
            const content = `⚠️ 找不到「${parent}」相符的交易。`;
            const components = [{
              type: 1,
              components: [
                { type: 2, style: 1, label: '🔍 重新搜尋', custom_id: `amend_retype:${newAmount}` },
                { type: 2, style: 4, label: '取消', custom_id: 'amend_cancel' },
              ],
            }];
            await patchInteractionMessage(env, token, content, components);
          }
        } else {
          const content = `請輸入要修正的交易關鍵字：`;
          const components = [{
            type: 1,
            components: [
              { type: 2, style: 1, label: '🔍 搜尋交易', custom_id: `amend_retype:${newAmount}` },
              { type: 2, style: 4, label: '取消', custom_id: 'amend_cancel' },
            ],
          }];
          await patchInteractionMessage(env, token, content, components);
        }
      } catch (err) {
        console.error('handleAmendCommand async error:', err);
        await patchInteractionMessage(env, token, '❌ 操作失敗，請稍後再試。');
      }
    })()
  );

  return c.json({ type: 5 });
}

async function handleAmendSelect(
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  const customId = interaction.data?.custom_id ?? '';
  // custom_id: amend_select:{newAmount}:{txId}
  const rest = customId.slice('amend_select:'.length);
  const colonIdx = rest.indexOf(':');
  if (colonIdx === -1) return c.json({ type: 4, data: { content: '❌ 無效的操作' } });
  const newAmount = Number(rest.slice(0, colonIdx));
  const txId = rest.slice(colonIdx + 1);
  if (!newAmount || !txId) return c.json({ type: 4, data: { content: '❌ 無效的操作' } });

  const supabase = getSupabaseClient(c.env);
  try {
    const txData = await getTransactionWithItems(supabase, txId);
    const oldAmount = txData?.amount ?? 0;
    const desc = (txData?.transaction_items?.[0]?.name ?? txData?.note ?? '?') as string;

    await amendTransactionAmount(supabase, txId, newAmount);

    let warning = '';
    const items = txData?.transaction_items ?? [];
    if (items.length === 1 && items[0].amount === oldAmount) {
      await updateTransactionItemAmount(supabase, items[0].id, newAmount);
    } else if (items.length > 1 && items.some((i) => i.amount != null)) {
      warning = '\n⚠️ 項目金額需手動更新';
    }

    const budgetProgress = await getBudgetProgress(supabase);
    const content =
      `✅ 已修正：${desc} NT$${oldAmount} → NT$${newAmount}${warning}\n` +
      `📊 本月支出：$${budgetProgress.current_spend.toLocaleString()} / $${budgetProgress.monthly_budget.toLocaleString()} (${budgetProgress.percentage}%)`;
    return c.json({ type: 7, data: { content, components: [] } });
  } catch (err) {
    console.error('handleAmendSelect error:', err);
    return c.json({ type: 4, data: { content: '❌ 修正失敗，請稍後再試。' } });
  }
}

async function handleAmendRetype(
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  const customId = interaction.data?.custom_id ?? '';
  const newAmount = customId.slice('amend_retype:'.length);
  return c.json({
    type: 9, // MODAL
    data: {
      title: '重新搜尋交易',
      custom_id: `amend_modal:${newAmount}`,
      components: [{
        type: 1,
        components: [{
          type: 4, // TEXT_INPUT
          custom_id: 'search_term',
          style: 1,
          label: '交易關鍵字',
          placeholder: '例：Google Play',
          required: true,
        }],
      }],
    },
  });
}

async function handleAmendModalSubmit(
  c: Context<{ Bindings: Env; Variables: HonoVariables }>,
  interaction: DiscordInteraction
) {
  const customId = interaction.data?.custom_id ?? '';
  const newAmountStr = customId.slice('amend_modal:'.length);
  const newAmount = Number(newAmountStr);
  const searchTerm = interaction.data?.components?.[0]?.components?.[0]?.value ?? '';

  if (!newAmount || !searchTerm) {
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
          const content = `🔍 找到以下交易，請選擇要修正的項目：`;
          const buttons = candidates.map((row) => {
            const label = formatButtonLabel(row.amount, row.transaction_at);
            return { type: 2, style: 1, label, custom_id: `amend_select:${newAmount}:${row.id}` };
          });
          const components: object[] = [
            { type: 1, components: buttons },
            {
              type: 1,
              components: [
                { type: 2, style: 2, label: '🔍 重新搜尋', custom_id: `amend_retype:${newAmount}` },
                { type: 2, style: 4, label: '取消', custom_id: 'amend_cancel' },
              ],
            },
          ];
          await patchInteractionMessage(env, token, content, components);
        } else {
          const noMatchContent = `⚠️ 找不到「${searchTerm}」相符的交易。`;
          const noMatchComponents = [{
            type: 1,
            components: [
              { type: 2, style: 1, label: '🔍 重新搜尋', custom_id: `amend_retype:${newAmount}` },
              { type: 2, style: 4, label: '取消', custom_id: 'amend_cancel' },
            ],
          }];
          await patchInteractionMessage(env, token, noMatchContent, noMatchComponents);
        }
      } catch (err) {
        console.error('handleAmendModalSubmit error:', err);
        await patchInteractionMessage(env, token, '❌ 搜尋失敗，請稍後再試。');
      }
    })()
  );

  return c.json({ type: 6 }); // DEFERRED_UPDATE_MESSAGE
}

