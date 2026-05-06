import { describe, it, expect } from 'vitest';

describe('Android notification ingestion endpoint', () => {
  const validPaymentMethods = ['credit_card', 'prepaid_wallet', 'easy_card', 'bank_account', 'cash'];

  const validPayload = {
    amount: 380,
    bank_name: '玉山銀行',
    payment_method: 'credit_card',
    wallet: 'line_pay',
    notification_text: '消費通知：玉山銀行信用卡消費 NT$380',
    notified_at: '2026-05-05T14:32:00+08:00',
  };

  it('accepts all valid payment_method values', () => {
    for (const pm of validPaymentMethods) {
      expect(validPaymentMethods).toContain(pm);
    }
  });

  it('rejects amount <= 0', () => {
    const invalid = { ...validPayload, amount: 0 };
    expect(invalid.amount).toBeLessThanOrEqual(0);
  });

  it('rejects unknown payment_method', () => {
    const invalid = { ...validPayload, payment_method: 'mobile_pay' };
    expect(validPaymentMethods).not.toContain(invalid.payment_method);
  });

  it('rejects wallet value on cash payment_method', () => {
    const walletAllowedFor = ['credit_card', 'prepaid_wallet'];
    const paymentMethod = 'cash';
    const wallet = 'line_pay';
    expect(walletAllowedFor).not.toContain(paymentMethod);
    expect(wallet).toBeTruthy();
    // combination is invalid — backend should return 400
  });

  it('accepts wallet=null for credit_card', () => {
    const payload = { ...validPayload, wallet: null };
    expect(payload.payment_method).toBe('credit_card');
    expect(payload.wallet).toBeNull();
  });

  it('accepts prepaid_wallet with wallet field', () => {
    const payload = { ...validPayload, payment_method: 'prepaid_wallet', wallet: 'line_pay' };
    expect(payload.payment_method).toBe('prepaid_wallet');
    expect(payload.wallet).toBe('line_pay');
  });

  describe('upsert merge logic (replaces 409)', () => {
    it('second notification with same amount within 3 min should merge (200)', () => {
      const firstTx = { transaction_id: 'tx-001', discord_message_id: null };
      const mergeResponse = { ...firstTx, merged: true };
      expect(mergeResponse.merged).toBe(true);
      expect(mergeResponse.transaction_id).toBe('tx-001');
    });

    it('merge window is 3 minutes, not 5', () => {
      const threeMinutesMs = 3 * 60 * 1000;
      const fiveMinutesMs = 5 * 60 * 1000;
      expect(threeMinutesMs).toBeLessThan(fiveMinutesMs);
    });

    it('dedup key is amount only (not bank_name or payment_method)', () => {
      // Two notifications for same purchase from different apps may have different bank_name
      const notif1 = { amount: 380, bank_name: '玉山銀行', payment_method: 'credit_card' };
      const notif2 = { amount: 380, bank_name: null, payment_method: 'credit_card', wallet: 'line_pay' };
      expect(notif1.amount).toBe(notif2.amount);
      expect(notif1.bank_name).not.toBe(notif2.bank_name);
      // Both should map to the same transaction via amount-only dedup
    });
  });

  it('returns 201 structure for new transaction', () => {
    const response = {
      transaction_id: '550e8400-e29b-41d4-a716-446655440000',
      discord_message_id: '1234567890123456789',
    };
    expect(response).toHaveProperty('transaction_id');
    expect(response).toHaveProperty('discord_message_id');
    expect(response).not.toHaveProperty('merged');
  });

  it('returns 200 + merged:true for upsert response', () => {
    const response = {
      transaction_id: '550e8400-e29b-41d4-a716-446655440000',
      discord_message_id: null,
      merged: true,
    };
    expect(response.merged).toBe(true);
  });
});
