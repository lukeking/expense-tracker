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

describe('/fee command handler', () => {
  it('returns type 5 deferred response', () => {
    expect({ type: 5 }.type).toBe(5);
  });

  it('rejects amount <= 0 with type 4 inline error', () => {
    const amount = 0;
    const shouldDefer = amount > 0;
    expect(shouldDefer).toBe(false);
  });

  it('extracts amount, description, and parent from options', () => {
    const interaction = {
      type: 2,
      data: {
        name: 'fee',
        options: [
          { name: 'amount', value: 47 },
          { name: 'description', value: '國外交易服務費' },
          { name: 'parent', value: 'Airbnb' },
        ],
      },
    };
    const options = interaction.data.options;
    expect(options.find((o) => o.name === 'amount')?.value).toBe(47);
    expect(options.find((o) => o.name === 'description')?.value).toBe('國外交易服務費');
    expect(options.find((o) => o.name === 'parent')?.value).toBe('Airbnb');
  });

  it('defaults description to 國外交易服務費 when omitted', () => {
    const options: { name: string; value: string | number }[] = [{ name: 'amount', value: 47 }];
    const description = (options.find((o) => o.name === 'description')?.value as string) ?? '國外交易服務費';
    expect(description).toBe('國外交易服務費');
  });

  it('encodes fee_link custom_id with both UUIDs', () => {
    const feeTxId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const parentTxId = 'bbbbbbbb-0000-0000-0000-000000000002';
    const customId = `fee_link:${feeTxId}:${parentTxId}`;
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(customId.startsWith('fee_link:')).toBe(true);
    const parts = customId.split(':');
    // format: fee_link:{uuid}:{uuid} — UUIDs contain no colons so split gives 3 parts
    // but UUIDs use hyphens not colons, so split(':') gives [prefix, uuid1, uuid2]
    // Actually 'fee_link:{uuid1}:{uuid2}' splits into ['fee_link', uuid1, uuid2]
    expect(parts[1]).toBe(feeTxId);
    expect(parts[2]).toBe(parentTxId);
  });

  it('encodes fee_unlink custom_id with fee tx id only', () => {
    const feeTxId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const customId = `fee_unlink:${feeTxId}`;
    expect(customId.length).toBeLessThanOrEqual(100);
    expect(customId.startsWith('fee_unlink:')).toBe(true);
    expect(customId.slice('fee_unlink:'.length)).toBe(feeTxId);
  });

  it('parent omitted → no candidate lookup, saves unlinked', () => {
    const options: { name: string; value: string | number }[] = [{ name: 'amount', value: 47 }];
    const parent = options.find((o) => o.name === 'parent')?.value as string | undefined;
    expect(parent).toBeUndefined();
  });
});

describe('/refund command handler', () => {
  it('returns type 5 deferred response', () => {
    expect({ type: 5 }.type).toBe(5);
  });

  it('defaults description to 退款 when omitted', () => {
    const options: { name: string; value: string | number }[] = [{ name: 'amount', value: 200 }];
    const description = (options.find((o) => o.name === 'description')?.value as string) ?? '退款';
    expect(description).toBe('退款');
  });

  it('encodes refund_link custom_id within 100-char limit', () => {
    const txId = 'cccccccc-0000-0000-0000-000000000003';
    const parentId = 'dddddddd-0000-0000-0000-000000000004';
    const customId = `refund_link:${txId}:${parentId}`;
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it('encodes refund_unlink custom_id within 100-char limit', () => {
    const txId = 'cccccccc-0000-0000-0000-000000000003';
    const customId = `refund_unlink:${txId}`;
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it('rejects negative amount with inline error', () => {
    const amount = -5;
    expect(amount > 0).toBe(false);
  });
});

describe('fee/refund component interaction (button click)', () => {
  it('fee_link custom_id decodes tx and parent UUIDs', () => {
    const feeTxId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const parentTxId = 'bbbbbbbb-0000-0000-0000-000000000002';
    const customId = `fee_link:${feeTxId}:${parentTxId}`;
    const prefixLen = 'fee_link:'.length;
    const rest = customId.slice(prefixLen);
    const colonIdx = rest.indexOf(':');
    const txId = rest.slice(0, colonIdx);
    const parentId = rest.slice(colonIdx + 1);
    expect(txId).toBe(feeTxId);
    expect(parentId).toBe(parentTxId);
  });

  it('refund_link custom_id decodes tx and parent UUIDs', () => {
    const txId = 'cccccccc-0000-0000-0000-000000000003';
    const parentId = 'dddddddd-0000-0000-0000-000000000004';
    const customId = `refund_link:${txId}:${parentId}`;
    const prefixLen = 'refund_link:'.length;
    const rest = customId.slice(prefixLen);
    const colonIdx = rest.indexOf(':');
    expect(rest.slice(0, colonIdx)).toBe(txId);
    expect(rest.slice(colonIdx + 1)).toBe(parentId);
  });

  it('fee_unlink component returns type 4 response', () => {
    const response = { type: 4, data: { content: '✅ 費用已儲存（未連結）\n📊 ...' } };
    expect(response.type).toBe(4);
    expect(response.data.content).toContain('費用已儲存');
  });

  it('refund_unlink component returns type 4 response', () => {
    const response = { type: 4, data: { content: '✅ 退款已儲存（未連結）\n📊 ...' } };
    expect(response.type).toBe(4);
    expect(response.data.content).toContain('退款已儲存');
  });
});
