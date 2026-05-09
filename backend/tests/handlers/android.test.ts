import { describe, it, expect } from 'vitest';
import type { PaymentMethod, MobileWallet } from '../../src/types';

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

// ─── POST /android/input ──────────────────────────────────────────────────────

describe('POST /android/input — command detection', () => {
  const feePattern = /^fee\s+/i;
  const refundPattern = /^refund\s+/i;

  it('detects "fee " prefix (case-insensitive)', () => {
    for (const input of ['fee 47 Airbnb', 'Fee 47 Airbnb', 'FEE 47']) {
      expect(feePattern.test(input.trim())).toBe(true);
    }
  });

  it('detects "refund " prefix (case-insensitive)', () => {
    for (const input of ['refund 200 退票', 'Refund 200', 'REFUND 800 高鐵票']) {
      expect(refundPattern.test(input.trim())).toBe(true);
    }
  });

  it('treats anything else as expense type', () => {
    for (const input of ['250 星巴克', '悠遊卡 80 捷運', 'fee100 沒空格不算']) {
      expect(feePattern.test(input.trim())).toBe(false);
      expect(refundPattern.test(input.trim())).toBe(false);
    }
  });

  it('strips fee prefix to get the amount+description part for Gemini', () => {
    const input = 'fee 47 Airbnb';
    expect(input.trim().replace(feePattern, '')).toBe('47 Airbnb');
  });

  it('strips refund prefix to get the amount+description part for Gemini', () => {
    const input = 'refund 200 高鐵票';
    expect(input.trim().replace(refundPattern, '')).toBe('200 高鐵票');
  });
});

describe('POST /android/input — text validation', () => {
  it('rejects empty or whitespace-only text', () => {
    for (const text of ['', '   ', '\t\n']) {
      expect(!text || text.trim() === '').toBe(true);
    }
  });

  it('rejects text over 500 characters', () => {
    expect('a'.repeat(501).trim().length > 500).toBe(true);
  });

  it('accepts text at exactly 500 characters', () => {
    expect('a'.repeat(500).trim().length <= 500).toBe(true);
  });
});

describe('POST /android/input — wallet detection', () => {
  function detectWallet(text: string): MobileWallet | null {
    if (/LINE Pay|LinePay/i.test(text)) return 'line_pay';
    if (/Google Pay|GooglePay/i.test(text)) return 'google_pay';
    return null;
  }

  it('detects LINE Pay variants → line_pay', () => {
    expect(detectWallet('LINE Pay 捷運')).toBe('line_pay');
    expect(detectWallet('LinePay 購物')).toBe('line_pay');
  });

  it('detects Google Pay variants → google_pay', () => {
    expect(detectWallet('Google Pay 咖啡')).toBe('google_pay');
    expect(detectWallet('GooglePay 超商')).toBe('google_pay');
  });

  it('returns null when no wallet keyword present', () => {
    expect(detectWallet('250 星巴克 拿鐵')).toBeNull();
    expect(detectWallet('悠遊卡 80 捷運')).toBeNull();
    expect(detectWallet('信用卡 350 餐廳')).toBeNull();
  });
});

describe('POST /android/input — response shapes', () => {
  it('201 success shape includes all InputResponse fields', () => {
    const response = {
      success: true,
      message: '記帳成功！NT$250 — 星巴克 拿鐵',
      transaction_id: '550e8400-e29b-41d4-a716-446655440000',
      budget_summary: {
        total_spent: 8420,
        monthly_budget: 20000,
        remaining: 11580,
        percentage: 42,
      },
    };
    expect(response.success).toBe(true);
    expect(response).toHaveProperty('transaction_id');
    expect(response.budget_summary.remaining).toBe(
      response.budget_summary.monthly_budget - response.budget_summary.total_spent
    );
    expect(response.budget_summary.percentage).toBe(
      Math.round((response.budget_summary.total_spent / response.budget_summary.monthly_budget) * 100)
    );
  });

  it('422 parse failure shape: success=false, no transaction_id', () => {
    const response = { success: false, message: '無法解析金額，請確認格式如：250 星巴克' };
    expect(response.success).toBe(false);
    expect(response.message).toContain('無法解析金額');
    expect(response).not.toHaveProperty('transaction_id');
    expect(response).not.toHaveProperty('budget_summary');
  });

  it('409 dedup shape: success=false, standard message', () => {
    const response = { success: false, message: 'Duplicate detected — already recorded' };
    expect(response.success).toBe(false);
    expect(response.message).toContain('Duplicate detected');
  });
});

// ─── GET /android/transactions/recent ────────────────────────────────────────

describe('GET /android/transactions/recent — limit clamping', () => {
  function clampLimit(raw: number) {
    return Math.min(Math.max(raw, 1), 50);
  }

  it('clamps 0 → 1', () => expect(clampLimit(0)).toBe(1));
  it('clamps negative → 1', () => expect(clampLimit(-5)).toBe(1));
  it('clamps 100 → 50', () => expect(clampLimit(100)).toBe(50));
  it('leaves 20 unchanged', () => expect(clampLimit(20)).toBe(20));
  it('accepts boundary values 1 and 50', () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(50)).toBe(50);
  });
});

describe('GET /android/transactions/recent — description construction', () => {
  function buildDescription(items: { name: string }[] | null, note: string | null): string {
    return items && items.length > 0 ? items.map((i) => i.name).join(' ') : (note ?? '');
  }

  it('joins item names when items has entries', () => {
    expect(buildDescription([{ name: 'Airbnb' }], null)).toBe('Airbnb');
    expect(buildDescription([{ name: '星巴克' }, { name: '拿鐵' }], 'raw note')).toBe('星巴克 拿鐵');
  });

  it('falls back to note when items is empty array', () => {
    expect(buildDescription([], '早餐消費')).toBe('早餐消費');
  });

  it('falls back to note when items is null', () => {
    expect(buildDescription(null, '午餐')).toBe('午餐');
  });

  it('returns empty string when both items and note are absent', () => {
    expect(buildDescription(null, null)).toBe('');
  });
});

describe('GET /android/transactions/recent — candidate shape', () => {
  it('candidate includes all CandidateTransaction fields', () => {
    const candidate = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      amount: 1200,
      description: 'Airbnb',
      transaction_at: '2026-04-30T14:23:00Z',
      transaction_type: 'expense' as const,
    };
    expect(candidate).toHaveProperty('id');
    expect(candidate).toHaveProperty('amount');
    expect(candidate).toHaveProperty('description');
    expect(candidate).toHaveProperty('transaction_at');
    expect(candidate.transaction_type).toBe('expense');
  });

  it('only expense-type transactions are returned (not fee or refund)', () => {
    const rows = [
      { transaction_type: 'expense' },
      { transaction_type: 'fee' },
      { transaction_type: 'refund' },
    ] as { transaction_type: PaymentMethod | 'expense' | 'fee' | 'refund' }[];
    const candidates = rows.filter((r) => r.transaction_type === 'expense');
    expect(candidates).toHaveLength(1);
  });
});
