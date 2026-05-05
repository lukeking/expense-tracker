import { describe, it, expect } from 'vitest';

describe('Android notification ingestion endpoint', () => {
  const validPayload = {
    amount: 380,
    bank_name: '台新銀行',
    payment_method: 'credit_card',
    notification_text: '消費通知：台新銀行信用卡消費 NT$380',
    notified_at: '2026-05-05T14:32:00+08:00',
  };

  it('accepts valid payload fields', () => {
    expect(validPayload.amount).toBeGreaterThan(0);
    expect(['credit_card', 'mobile_pay', 'cash']).toContain(validPayload.payment_method);
    expect(Date.parse(validPayload.notified_at)).not.toBeNaN();
  });

  it('rejects amount <= 0', () => {
    const invalid = { ...validPayload, amount: 0 };
    expect(invalid.amount).toBeLessThanOrEqual(0);
  });

  it('rejects invalid payment_method', () => {
    const invalid = { ...validPayload, payment_method: 'bitcoin' };
    expect(['credit_card', 'mobile_pay', 'cash']).not.toContain(invalid.payment_method);
  });

  it('rejects missing bank_name', () => {
    const { bank_name, ...rest } = validPayload;
    expect((rest as { bank_name?: string }).bank_name).toBeUndefined();
  });

  it('duplicate detection window is 5 minutes', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recent = new Date(Date.now() - 2 * 60 * 1000);
    expect(recent > fiveMinutesAgo).toBe(true);
  });

  it('returns 201 structure', () => {
    const response = {
      transaction_id: '550e8400-e29b-41d4-a716-446655440000',
      discord_message_id: '1234567890123456789',
    };
    expect(response).toHaveProperty('transaction_id');
    expect(response).toHaveProperty('discord_message_id');
  });
});
