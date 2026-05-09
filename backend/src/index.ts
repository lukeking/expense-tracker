import { Hono } from 'hono';
import type { Env } from './types';
import { discordVerify } from './middleware/discord-verify';
import { androidAuth } from './middleware/android-auth';
import { discordHandler } from './handlers/discord';
import { androidNotificationHandler, androidInputHandler, recentTransactionsHandler, healthHandler } from './handlers/android';
import { handleMofSync } from './handlers/mof-sync';
import { getSupabaseClient } from './db/client';
import { sendChannelMessage } from './services/discord-notify';

const app = new Hono<{ Bindings: Env }>();

app.post('/discord/interactions', discordVerify, discordHandler);
app.post('/api/notification', androidAuth, androidNotificationHandler);
app.post('/android/input', androidAuth, androidInputHandler);
app.get('/android/transactions/recent', androidAuth, recentTransactionsHandler);
app.get('/api/health', healthHandler);

export function formatReminderMessage(latestRun: { uploaded_at: string; file_name: string | null } | null): string {
  const lines = [
    '📋 **發票匯入提醒**',
    '請至財政部電子發票整合服務平台下載最新 CSV 並使用 `/import` 上傳。',
  ];
  if (latestRun) {
    const utc8Date = new Date(new Date(latestRun.uploaded_at).getTime() + 8 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    lines.push(`上次匯入：${utc8Date}（${latestRun.file_name ?? '未知檔案'}）`);
  }
  return lines.join('\n');
}

async function sendInvoiceReminder(env: Env): Promise<void> {
  const supabase = getSupabaseClient(env);
  const { data } = await supabase
    .from('import_runs')
    .select('uploaded_at, file_name')
    .order('uploaded_at', { ascending: false })
    .limit(1);
  const latestRun = data?.[0] ?? null;
  await sendChannelMessage(env, formatReminderMessage(latestRun));
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 9 1 */2 *') {
      ctx.waitUntil(sendInvoiceReminder(env));
    } else {
      ctx.waitUntil(handleMofSync(env));
    }
  },
};
