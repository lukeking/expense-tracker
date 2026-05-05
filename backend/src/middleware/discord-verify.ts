import type { Context, Next } from 'hono';
import * as ed from '@noble/ed25519';
import type { Env } from '../types';

export async function discordVerify(c: Context<{ Bindings: Env }>, next: Next) {
  const signature = c.req.header('x-signature-ed25519');
  const timestamp = c.req.header('x-signature-timestamp');

  if (!signature || !timestamp) {
    return c.text('Unauthorized', 401);
  }

  const body = await c.req.text();

  try {
    const isValid = await ed.verifyAsync(
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
      hexToBytes(c.env.DISCORD_PUBLIC_KEY)
    );
    if (!isValid) return c.text('Unauthorized', 401);
  } catch {
    return c.text('Unauthorized', 401);
  }

  // Re-expose raw body for downstream handlers
  c.set('rawBody', body);
  await next();
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
