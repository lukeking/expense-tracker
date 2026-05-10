import { describe, it, expect } from 'vitest';
import { parseDescription } from '../../src/services/expense-parser';

describe('parseDescription', () => {
  it('(a) credit_card + categoryTag + note + two items → no warning when sum matches', () => {
    const result = parseDescription('信用卡, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50', 300);
    expect(result.paymentMethod).toBe('credit_card');
    expect(result.categoryTag).toBe('食:午餐');
    expect(result.plainTags).toEqual([]);
    expect(result.note).toBe('麥當勞');
    expect(result.items).toEqual([
      { name: '大麥克套餐', amount: 250 },
      { name: '蘋果派', amount: 50 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('(b) sum mismatch → warning includes NT$ totals and diff', () => {
    const result = parseDescription('現金, #食:午餐, 麥當勞, 大麥克套餐 250, 蘋果派 50', 350);
    expect(result.items).toEqual([
      { name: '大麥克套餐', amount: 250 },
      { name: '蘋果派', amount: 50 },
    ]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('NT$300');
    expect(result.warnings[0]).toContain('NT$350');
    expect(result.warnings[0]).toContain('NT$50');
  });

  it('(c) easy_card + route note + categoryTag + no items', () => {
    const result = parseDescription('悠遊卡, 亞東醫院→忠孝復興, #行:捷運', 35);
    expect(result.paymentMethod).toBe('easy_card');
    expect(result.categoryTag).toBe('行:捷運');
    expect(result.note).toBe('亞東醫院→忠孝復興');
    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('(d) plain #tag without colon → plainTags, categoryTag null', () => {
    const result = parseDescription('現金, #三商巧福', 80);
    expect(result.paymentMethod).toBe('cash');
    expect(result.categoryTag).toBeNull();
    expect(result.plainTags).toEqual(['三商巧福']);
    expect(result.items).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('(e) two #cat:sub tokens → first used + warning, second ignored', () => {
    const result = parseDescription('#食:午餐, #行:捷運, 咖啡 80', 80);
    expect(result.categoryTag).toBe('食:午餐');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('食:午餐');
    expect(result.warnings[0]).toContain('忽略');
  });

  it('(f) payment keyword matching is case-insensitive', () => {
    expect(parseDescription('Cash, 星巴克 100', 100).paymentMethod).toBe('cash');
    expect(parseDescription('CREDIT_CARD, 星巴克 100', 100).paymentMethod).toBe('credit_card');
    expect(parseDescription('Easy Card, 悠遊卡測試 50', 50).paymentMethod).toBe('easy_card');
  });

  it('(g) trailing-number token → line item, not note', () => {
    const result = parseDescription('現金, 拿鐵咖啡 150', 150);
    expect(result.items).toEqual([{ name: '拿鐵咖啡', amount: 150 }]);
    expect(result.note).toBe('');
  });

  it('(h) freeform text without trailing number → note, not item', () => {
    const result = parseDescription('現金, 麥當勞早餐', 80);
    expect(result.items).toEqual([]);
    expect(result.note).toBe('麥當勞早餐');
  });

  it('(i) empty string → all null/empty fields', () => {
    const result = parseDescription('', 100);
    expect(result.paymentMethod).toBeNull();
    expect(result.categoryTag).toBeNull();
    expect(result.plainTags).toEqual([]);
    expect(result.items).toEqual([]);
    expect(result.note).toBe('');
    expect(result.warnings).toEqual([]);
  });

  it('multi-colon tag: subcategory includes everything after first colon', () => {
    const result = parseDescription('#食:港式:飲茶, 茶樓 500', 500);
    expect(result.categoryTag).toBe('食:港式:飲茶');
  });

  it('single-word numeric token is not treated as a line item', () => {
    const result = parseDescription('現金, 300', 300);
    expect(result.items).toEqual([]);
    expect(result.note).toBe('300');
  });
});
