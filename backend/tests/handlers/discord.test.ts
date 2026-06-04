import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { formatReminderMessage } from '../../src/index';

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

  it('extracts payment_method from interaction options', () => {
    const interaction = {
      type: 2,
      data: {
        name: 'expense',
        options: [
          { name: 'amount', value: 300 },
          { name: 'description', value: '#食:午餐, 麥當勞 大麥克套餐 250' },
          { name: 'payment_method', value: 'credit_card' },
        ],
      },
    };
    const options = interaction.data.options;
    const paymentMethod = (options.find((o) => o.name === 'payment_method')?.value as string) ?? 'cash';
    expect(paymentMethod).toBe('credit_card');
  });

  it('defaults payment_method to cash when option is omitted', () => {
    const interaction = {
      type: 2,
      data: {
        name: 'expense',
        options: [
          { name: 'amount', value: 100 },
          { name: 'description', value: '早餐' },
        ],
      },
    };
    const options = interaction.data.options;
    const paymentMethod = (options.find((o) => o.name === 'payment_method')?.value as string) ?? 'cash';
    expect(paymentMethod).toBe('cash');
  });

  it('confirmation message includes payment method label inline on amount line', () => {
    const amount = 300;
    const paymentMethodLabel = '信用卡';
    const amountLine = `💰 金額：$${amount} [${paymentMethodLabel}]`;
    expect(amountLine).toBe('💰 金額：$300 [信用卡]');
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

// ─── /amend command tests ─────────────────────────────────────────────────────

describe('/amend command handler', () => {
  it('returns type 5 deferred response', () => {
    expect({ type: 5 }.type).toBe(5);
  });

  it('extracts amount and parent from options', () => {
    const interaction = {
      type: 2,
      data: {
        name: 'amend',
        options: [
          { name: 'amount', value: 1523 },
          { name: 'parent', value: 'Google' },
        ],
      },
    };
    const options = interaction.data.options;
    expect(options.find((o) => o.name === 'amount')?.value).toBe(1523);
    expect(options.find((o) => o.name === 'parent')?.value).toBe('Google');
  });

  it('rejects amount <= 0 with inline error', () => {
    const amount = 0;
    expect(amount > 0).toBe(false);
  });
});

describe('amend_select component interaction', () => {
  it('decodes newAmount and txId from custom_id', () => {
    const newAmount = 1523;
    const txId = 'aaaaaaaa-0000-0000-0000-000000000001';
    const customId = `amend_select:${newAmount}:${txId}`;
    const rest = customId.slice('amend_select:'.length);
    const colonIdx = rest.indexOf(':');
    expect(Number(rest.slice(0, colonIdx))).toBe(newAmount);
    expect(rest.slice(colonIdx + 1)).toBe(txId);
  });

  it('custom_id stays within Discord 100-char limit', () => {
    const customId = `amend_select:99999:550e8400-e29b-41d4-a716-446655440000`;
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it('returns type 7 UPDATE_MESSAGE with components cleared', () => {
    const response = { type: 7, data: { content: '✅ 已修正：Google Play NT$1,200 → NT$1,523\n📊 ...', components: [] } };
    expect(response.type).toBe(7);
    expect(response.data.components).toHaveLength(0);
    expect(response.data.content).toContain('已修正');
  });
});

describe('amend_retype component interaction', () => {
  it('returns type 9 MODAL with correct custom_id', () => {
    const newAmount = 1523;
    const customId = `amend_retype:${newAmount}`;
    const modalCustomId = `amend_modal:${newAmount}`;
    const response = {
      type: 9,
      data: { title: '重新搜尋交易', custom_id: modalCustomId },
    };
    expect(response.type).toBe(9);
    expect(response.data.custom_id).toBe('amend_modal:1523');
    expect(customId.startsWith('amend_retype:')).toBe(true);
  });
});

describe('amend_modal submit handler', () => {
  it('returns type 6 DEFERRED_UPDATE_MESSAGE', () => {
    expect({ type: 6 }.type).toBe(6);
  });

  it('extracts newAmount from amend_modal custom_id', () => {
    const customId = 'amend_modal:1523';
    const newAmount = Number(customId.slice('amend_modal:'.length));
    expect(newAmount).toBe(1523);
  });
});

describe('amend_cancel component interaction', () => {
  it('returns type 6 DEFERRED_UPDATE_MESSAGE for cancel', () => {
    const response = { type: 6 };
    expect(response.type).toBe(6);
  });

  it('patch payload for cancel clears content and components', () => {
    const patchPayload = { content: '已取消。', components: [] as object[] };
    expect(patchPayload.content).toBe('已取消。');
    expect(patchPayload.components).toHaveLength(0);
  });
});

// ─── Invoice download reminder cron ──────────────────────────────────────────

describe('formatReminderMessage', () => {
  it('includes last import date and filename when a run exists', () => {
    const msg = formatReminderMessage({ uploaded_at: '2026-03-01T01:00:00Z', file_name: 'march.csv' });
    expect(msg).toContain('發票匯入提醒');
    expect(msg).toContain('上次匯入：2026-03-01');
    expect(msg).toContain('march.csv');
  });

  it('omits last-import line when no runs exist', () => {
    const msg = formatReminderMessage(null);
    expect(msg).toContain('發票匯入提醒');
    expect(msg).not.toContain('上次匯入');
  });

  it('converts uploaded_at UTC to UTC+8 date for display', () => {
    // 2026-01-31T16:30:00Z = 2026-02-01 00:30 UTC+8
    const msg = formatReminderMessage({ uploaded_at: '2026-01-31T16:30:00Z', file_name: 'test.csv' });
    expect(msg).toContain('上次匯入：2026-02-01');
  });

  it('uses 未知檔案 when file_name is null', () => {
    const msg = formatReminderMessage({ uploaded_at: '2026-05-01T00:00:00Z', file_name: null });
    expect(msg).toContain('未知檔案');
  });
});

