import { describe, it, expect } from 'vitest';
import { parseDescription } from '../../src/services/expense-parser';

describe('parseDescription — contract examples', () => {
  it('credit card + category tag + note + two items, sums match → no warnings', () => {
    const result = parseDescription('信用卡, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50', 300);
    expect(result.paymentMethod).toBe('credit_card');
    expect(result.categoryTag).toBe('食:午餐');
    expect(result.note).toBe('麥當勞');
    expect(result.items).toEqual([
      { name: '大麥克套餐', amount: 250 },
      { name: '蘋果派', amount: 50 },
    ]);
    expect(result.warnings).toHaveLength(0);
  });

  it('easy card + category tag + note, no items → no warnings', () => {
    const result = parseDescription('悠遊卡, 亞東醫院→忠孝復興, #行:捷運', 35);
    expect(result.paymentMethod).toBe('easy_card');
    expect(result.categoryTag).toBe('行:捷運');
    expect(result.note).toBe('亞東醫院→忠孝復興');
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('cash + plain tag (no colon) → categoryTag=null, plainTags set', () => {
    const result = parseDescription('現金, #三商巧福', 80);
    expect(result.paymentMethod).toBe('cash');
    expect(result.categoryTag).toBeNull();
    expect(result.plainTags).toEqual(['三商巧福']);
    expect(result.note).toBe('');
    expect(result.items).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('sum mismatch → mismatch warning', () => {
    const result = parseDescription('現金, #食:午餐, 大麥克套餐 250, 蘋果派 50', 350);
    expect(result.paymentMethod).toBe('cash');
    expect(result.categoryTag).toBe('食:午餐');
    expect(result.items).toEqual([
      { name: '大麥克套餐', amount: 250 },
      { name: '蘋果派', amount: 50 },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('NT$300 ≠ 總金額 NT$350');
    expect(result.warnings[0]).toContain('NT$50 未歸類');
  });
});

describe('parseDescription — FR-005 duplicate category warning', () => {
  it('second #cat:sub token emits duplicate warning and is ignored', () => {
    const result = parseDescription('#食:午餐, #行:捷運, 麥當勞 100', 100);
    expect(result.categoryTag).toBe('食:午餐');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('僅使用第一個分類標籤 #食:午餐');
    expect(result.warnings[0]).toContain('其餘忽略');
  });

  it('duplicate warning shows the first categoryTag in the message', () => {
    const result = parseDescription('#住:租金, #食:外食', 1000);
    expect(result.categoryTag).toBe('住:租金');
    expect(result.warnings[0]).toContain('#住:租金');
  });
});

describe('parseDescription — FR-006 mismatch cases', () => {
  it('items sum greater than totalAmount → mismatch warning', () => {
    const result = parseDescription('咖啡 100, 蛋糕 80', 150);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('NT$180 ≠ 總金額 NT$150');
    expect(result.warnings[0]).toContain('NT$30 未歸類');
  });

  it('no items → no mismatch warning regardless of totalAmount', () => {
    const result = parseDescription('現金, #食:外食', 999);
    expect(result.warnings).toHaveLength(0);
  });

  it('items sum equals totalAmount exactly → no warning', () => {
    const result = parseDescription('現金, 咖啡 80', 80);
    expect(result.warnings).toHaveLength(0);
  });
});

describe('parseDescription — payment keyword matching', () => {
  it.each([
    ['現金', 'cash'],
    ['cash', 'cash'],
    ['信用卡', 'credit_card'],
    ['credit card', 'credit_card'],
    ['credit_card', 'credit_card'],
    ['悠遊卡', 'easy_card'],
    ['easy card', 'easy_card'],
    ['easy_card', 'easy_card'],
    ['行動支付', 'prepaid_wallet'],
    ['line pay', 'prepaid_wallet'],
    ['google pay', 'prepaid_wallet'],
    ['apple pay', 'prepaid_wallet'],
    ['prepaid_wallet', 'prepaid_wallet'],
    ['銀行轉帳', 'bank_account'],
    ['bank transfer', 'bank_account'],
    ['bank_account', 'bank_account'],
  ])('%s → %s', (keyword, expected) => {
    const result = parseDescription(keyword, 0);
    expect(result.paymentMethod).toBe(expected);
  });

  it('payment keywords are case-insensitive', () => {
    expect(parseDescription('CASH', 0).paymentMethod).toBe('cash');
    expect(parseDescription('LINE PAY', 0).paymentMethod).toBe('prepaid_wallet');
  });

  it('no payment keyword → paymentMethod is null', () => {
    const result = parseDescription('#食:午餐, 麥當勞 100', 100);
    expect(result.paymentMethod).toBeNull();
  });
});

describe('parseDescription — line item classification', () => {
  it('single-word token is not a line item (no numeric suffix)', () => {
    const result = parseDescription('麥當勞', 100);
    expect(result.items).toHaveLength(0);
    expect(result.note).toBe('麥當勞');
  });

  it('multi-word token with numeric last word → line item', () => {
    const result = parseDescription('大麥克套餐 250', 250);
    expect(result.items).toEqual([{ name: '大麥克套餐', amount: 250 }]);
  });

  it('multi-word note (no numeric last word) → note', () => {
    const result = parseDescription('亞東醫院 忠孝復興', 100);
    expect(result.items).toHaveLength(0);
    expect(result.note).toBe('亞東醫院 忠孝復興');
  });
});

describe('parseDescription — note accumulation', () => {
  it('multiple non-classified tokens → joined with space', () => {
    const result = parseDescription('早餐, 便利商店', 50);
    expect(result.note).toBe('早餐 便利商店');
  });

  it('empty description → all fields empty/null', () => {
    const result = parseDescription('', 100);
    expect(result.paymentMethod).toBeNull();
    expect(result.categoryTag).toBeNull();
    expect(result.plainTags).toHaveLength(0);
    expect(result.items).toHaveLength(0);
    expect(result.note).toBe('');
    expect(result.warnings).toHaveLength(0);
  });
});
