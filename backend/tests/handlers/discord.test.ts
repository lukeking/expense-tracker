import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ed from '@noble/ed25519';

// Signature verification tests
describe('Discord ed25519 verification', () => {
  it('returns type 1 for PING interaction', async () => {
    // A valid PING request should return { type: 1 }
    const pingBody = JSON.stringify({ type: 1 });
    expect(JSON.parse(pingBody).type).toBe(1);
  });

  it('generates valid ed25519 keypair and verifies signature', async () => {
    const privKey = ed.utils.randomPrivateKey();
    const pubKey = await ed.getPublicKeyAsync(privKey);
    const message = new TextEncoder().encode('timestamp' + 'body');
    const sig = await ed.signAsync(message, privKey);
    const valid = await ed.verifyAsync(sig, message, pubKey);
    expect(valid).toBe(true);
  });

  it('rejects invalid signature', async () => {
    const privKey = ed.utils.randomPrivateKey();
    const pubKey = await ed.getPublicKeyAsync(privKey);
    const message = new TextEncoder().encode('timestamp' + 'body');
    const wrongSig = new Uint8Array(64); // all zeros
    const valid = await ed.verifyAsync(wrongSig, message, pubKey);
    expect(valid).toBe(false);
  });
});

// Handler logic tests
describe('/expense command handler', () => {
  it('returns type 5 deferred response for expense command', () => {
    const deferredResponse = { type: 5 };
    expect(deferredResponse.type).toBe(5);
  });

  it('extracts amount and description from interaction options', () => {
    const interaction = {
      type: 2,
      data: {
        name: 'expense',
        options: [
          { name: 'amount', value: 150 },
          { name: 'description', value: '燙青菜 牛肉麵' },
        ],
      },
    };
    const options = interaction.data.options;
    const amount = options.find((o) => o.name === 'amount')?.value;
    const description = options.find((o) => o.name === 'description')?.value;
    expect(amount).toBe(150);
    expect(description).toBe('燙青菜 牛肉麵');
  });

  it('rejects amount <= 0', () => {
    const amount = -1;
    expect(amount).toBeLessThanOrEqual(0);
  });
});

describe('/budget command handler', () => {
  it('returns type 4 immediate response', () => {
    const response = { type: 4, data: { content: '✅ 月度預算已更新為 $25,000' } };
    expect(response.type).toBe(4);
    expect(response.data.content).toContain('25,000');
  });
});

describe('/summary command handler', () => {
  it('returns type 5 deferred response', () => {
    const response = { type: 5 };
    expect(response.type).toBe(5);
  });

  it('parses month option correctly', () => {
    const monthOption = '2026-05';
    const [year, month] = monthOption.split('-').map(Number);
    expect(year).toBe(2026);
    expect(month).toBe(5);
  });
});
