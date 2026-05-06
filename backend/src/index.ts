import { Hono } from 'hono';
import type { Env } from './types';
import { discordVerify } from './middleware/discord-verify';
import { androidAuth } from './middleware/android-auth';
import { discordHandler } from './handlers/discord';
import { androidNotificationHandler, androidInputHandler, recentTransactionsHandler, healthHandler } from './handlers/android';
import { handleMofSync } from './handlers/mof-sync';

const app = new Hono<{ Bindings: Env }>();

app.post('/discord/interactions', discordVerify, discordHandler);
app.post('/api/notification', androidAuth, androidNotificationHandler);
app.post('/android/input', androidAuth, androidInputHandler);
app.get('/android/transactions/recent', androidAuth, recentTransactionsHandler);
app.get('/api/health', healthHandler);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleMofSync(env));
  },
};
