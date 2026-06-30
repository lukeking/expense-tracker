import { Hono } from 'hono';
import type { Env, HonoVariables } from './types';
import { discordVerify } from './middleware/discord-verify';
import { androidAuth } from './middleware/android-auth';
import { discordHandler } from './handlers/discord';
import { androidNotificationHandler, androidInputHandler, recentTransactionsHandler, healthHandler } from './handlers/android';
import { pwaRouter } from './handlers/pwa';
import { getSupabaseClient } from './db/client';
import { sendChannelMessage } from './services/discord-notify';

const app = new Hono<{ Bindings: Env; Variables: HonoVariables }>();

app.post('/discord/interactions', discordVerify, discordHandler);
app.post('/api/notification', androidAuth, androidNotificationHandler);
app.post('/android/input', androidAuth, androidInputHandler);
app.get('/android/transactions/recent', androidAuth, recentTransactionsHandler);
app.get('/api/health', healthHandler);
app.route('/pwa', pwaRouter);

export function formatReminderMessage(latestRun: { uploaded_at: string; file_name: string | null } | null): string {
  const lines = [
    '📋 **發票匯入提醒**',
    '請至財政部電子發票整合服務平台下載最新 CSV，並於 PWA 的「匯入」頁面上傳。',
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

// Trivial read so the Supabase free-tier project never hits its 7-day inactivity pause:
// the pause timer resets on any incoming API request, and a daily query keeps it alive
// even if the PWA goes unused for a week (a paused project on free tier has no backups and
// is eventually deleted). Cheapest safe query — one row from the small categories table.
async function keepAlivePing(env: Env): Promise<void> {
  const supabase = getSupabaseClient(env);
  await supabase.from('categories').select('major').limit(1);
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === '0 1 26 */2 *') {
      ctx.waitUntil(sendInvoiceReminder(env));
    } else {
      // Daily '0 2 * * *' keep-alive (and a safe default for any other schedule).
      ctx.waitUntil(keepAlivePing(env));
    }
  },
};
