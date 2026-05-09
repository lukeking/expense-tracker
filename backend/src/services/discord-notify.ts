import type { Env, Transaction, Receipt, BudgetProgress } from '../types';

const DISCORD_API = 'https://discord.com/api/v10';

export async function patchInteractionMessage(
  env: Env,
  token: string,
  content: string,
  components?: object[]
): Promise<string | null> {
  const url = `${DISCORD_API}/webhooks/${env.DISCORD_APPLICATION_ID}/${token}/messages/@original`;
  const body: Record<string, unknown> = { content };
  if (components !== undefined) body.components = components;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error('patchInteractionMessage failed:', res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function sendChannelMessage(
  env: Env,
  content: string,
  components?: object[]
): Promise<string | null> {
  const url = `${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify({ content, components }),
  });
  if (!res.ok) {
    console.error('sendChannelMessage failed:', res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function editChannelMessage(
  env: Env,
  messageId: string,
  content: string
): Promise<void> {
  const url = `${DISCORD_API}/channels/${env.DISCORD_CHANNEL_ID}/messages/${messageId}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    console.error('editChannelMessage failed:', res.status, await res.text());
  }
}

export async function sendTransactionNotification(
  env: Env,
  transaction: Transaction,
  budgetProgress: BudgetProgress
): Promise<string | null> {
  const dt = new Date(transaction.transaction_at);
  const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

  const content =
    `🔔 消費通知\n` +
    `💳 ${transaction.bank_name ?? '未知'}：$${transaction.amount}\n` +
    `🕐 ${dateStr}\n` +
    `📊 本月累計：$${budgetProgress.current_spend.toLocaleString()} / $${budgetProgress.monthly_budget.toLocaleString()} (${budgetProgress.percentage}%)\n` +
    `⏳ 等待發票對齊...`;

  return sendChannelMessage(env, content);
}

export async function patchTransactionMatchedMessage(
  env: Env,
  transaction: Transaction,
  receipt: Receipt
): Promise<void> {
  if (!transaction.discord_message_id) return;

  const itemsStr = receipt.items
    .slice(0, 5)
    .map((item) => `${item.name}$${item.amount}`)
    .join(', ');

  const content =
    `✅ 已對齊發票\n` +
    `💳 ${transaction.bank_name ?? '手動記帳'}：$${transaction.amount}\n` +
    `🏪 ${receipt.seller_name}\n` +
    `🧾 品項：${itemsStr || '無'}\n` +
    `🏷️ 自動標籤：${transaction.tags.join(', ') || '無'}\n`;

  await editChannelMessage(env, transaction.discord_message_id, content);
}

export async function sendAmbiguousMatchAlert(
  env: Env,
  transaction: Transaction,
  candidateReceipts: Receipt[]
): Promise<string | null> {
  const content =
    `❓ 發現多張可能的發票，請選擇正確的：\n` +
    `💳 交易：$${transaction.amount} (${transaction.transaction_at.slice(0, 10)})`;

  const components = [
    {
      type: 1,
      components: candidateReceipts.slice(0, 5).map((receipt) => ({
        type: 2,
        style: 1,
        label: `${receipt.seller_name} $${receipt.total_amount} (${receipt.invoice_date})`,
        custom_id: `confirm_match:${transaction.id}:${receipt.id}`,
      })),
    },
  ];

  return sendChannelMessage(env, content, components);
}

export async function sendDiscordAlert(env: Env, message: string): Promise<void> {
  await sendChannelMessage(env, message);
}
