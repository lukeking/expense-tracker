import type { Context, Next } from 'hono';
import type { Env } from '../types';

export async function androidAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const authHeader = c.req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  const key = authHeader.slice(7);
  if (key !== c.env.ANDROID_API_KEY) {
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }
  await next();
}
