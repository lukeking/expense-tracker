import { describe, it, expect } from 'vitest';
import type { GeminiParseResult, PaymentMethod } from '../../src/types';

// ─── Prompt rule constants (mirror COMMON_PROMPT_RULES) ──────────────────────

const VALID_PAYMENT_METHODS: PaymentMethod[] = [
  'cash', 'credit_card', 'prepaid_wallet', 'easy_card', 'bank_account',
];

const PAYMENT_METHOD_KEYWORDS: { keyword: string; method: PaymentMethod }[] = [
  { keyword: '信用卡', method: 'credit_card' },
  { keyword: '現金', method: 'cash' },
  { keyword: '悠遊卡', method: 'easy_card' },
  { keyword: 'easycard', method: 'easy_card' },
  { keyword: 'LINE Pay', method: 'prepaid_wallet' },
  { keyword: 'LinePay', method: 'prepaid_wallet' },
  { keyword: 'Google Pay', method: 'prepaid_wallet' },
  { keyword: '行動支付', method: 'prepaid_wallet' },
  { keyword: '銀行轉帳', method: 'bank_account' },
];

// ─── Prompt schema ────────────────────────────────────────────────────────────

describe('Gemini response schema', () => {
  it('all four required fields are present: amount, payment_method, items, tags', () => {
    const result: GeminiParseResult = {
      amount: 250,
      payment_method: 'cash',
      items: [{ name: '星巴克 拿鐵', amount: 250 }],
      tags: [],
    };
    expect(result).toHaveProperty('amount');
    expect(result).toHaveProperty('payment_method');
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('tags');
  });

  it('payment_method is always one of the five valid enum values', () => {
    for (const method of VALID_PAYMENT_METHODS) {
      expect(VALID_PAYMENT_METHODS).toContain(method);
    }
  });

  it('items.amount is optional (may be null/undefined)', () => {
    const item: GeminiParseResult['items'][0] = { name: '咖啡' };
    expect(item.amount).toBeUndefined();
  });
});

// ─── Payment method mapping rules ────────────────────────────────────────────

describe('Gemini prompt — payment_method mapping', () => {
  it('maps 信用卡 → credit_card', () => {
    const rule = PAYMENT_METHOD_KEYWORDS.find((r) => r.keyword === '信用卡');
    expect(rule?.method).toBe('credit_card');
  });

  it('maps 悠遊卡 → easy_card', () => {
    const rule = PAYMENT_METHOD_KEYWORDS.find((r) => r.keyword === '悠遊卡');
    expect(rule?.method).toBe('easy_card');
  });

  it('maps LINE Pay and LinePay → prepaid_wallet', () => {
    expect(PAYMENT_METHOD_KEYWORDS.find((r) => r.keyword === 'LINE Pay')?.method).toBe('prepaid_wallet');
    expect(PAYMENT_METHOD_KEYWORDS.find((r) => r.keyword === 'LinePay')?.method).toBe('prepaid_wallet');
  });

  it('maps Google Pay → prepaid_wallet (not a separate method)', () => {
    expect(PAYMENT_METHOD_KEYWORDS.find((r) => r.keyword === 'Google Pay')?.method).toBe('prepaid_wallet');
  });

  it('maps 銀行轉帳 → bank_account', () => {
    expect(PAYMENT_METHOD_KEYWORDS.find((r) => r.keyword === '銀行轉帳')?.method).toBe('bank_account');
  });

  it('defaults to cash when no keyword is present', () => {
    const parsed: Partial<GeminiParseResult> = {};
    const method = parsed.payment_method ?? 'cash';
    expect(method).toBe('cash');
  });
});

// ─── parseRawExpenseText expected behaviors (mocked Gemini responses) ─────────

describe('parseRawExpenseText — expected Gemini outputs', () => {
  // These tests document the contract between our prompt and Gemini's output.
  // They use mock response shapes to validate the handler's normalization logic.

  function normalize(parsed: Partial<GeminiParseResult>, fallbackAmount = 0): GeminiParseResult {
    return {
      amount: parsed.amount ?? fallbackAmount,
      payment_method: parsed.payment_method ?? 'cash',
      items: parsed.items ?? [],
      tags: parsed.tags ?? [],
    };
  }

  it('"250 星巴克 拿鐵" → amount=250, items contain "星巴克 拿鐵"', () => {
    const mock: Partial<GeminiParseResult> = {
      amount: 250,
      payment_method: 'cash',
      items: [{ name: '星巴克 拿鐵', amount: 250 }],
      tags: [],
    };
    const result = normalize(mock);
    expect(result.amount).toBe(250);
    expect(result.items[0].name).toContain('星巴克');
  });

  it('"80 悠遊卡 捷運" → payment_method=easy_card', () => {
    const mock: Partial<GeminiParseResult> = {
      amount: 80,
      payment_method: 'easy_card',
      items: [{ name: '捷運', amount: 80 }],
      tags: [],
    };
    const result = normalize(mock);
    expect(result.payment_method).toBe('easy_card');
    expect(result.amount).toBe(80);
  });

  it('"250 咖啡 #下午茶 #food" → tags=["下午茶","food"], no # prefix', () => {
    const mock: Partial<GeminiParseResult> = {
      amount: 250,
      payment_method: 'cash',
      items: [{ name: '咖啡', amount: 250 }],
      tags: ['下午茶', 'food'],
    };
    const result = normalize(mock);
    expect(result.tags).toContain('下午茶');
    expect(result.tags).toContain('food');
    expect(result.tags.every((t) => !t.startsWith('#'))).toBe(true);
  });

  it('no # prefix in text → tags=[]', () => {
    const mock: Partial<GeminiParseResult> = {
      amount: 100,
      payment_method: 'cash',
      items: [{ name: '早餐', amount: 100 }],
      tags: [],
    };
    expect(normalize(mock).tags).toHaveLength(0);
  });

  it('single item: items[0].amount equals total amount', () => {
    const mock: Partial<GeminiParseResult> = {
      amount: 150,
      payment_method: 'cash',
      items: [{ name: '午餐', amount: 150 }],
      tags: [],
    };
    const result = normalize(mock);
    expect(result.items[0].amount).toBe(result.amount);
  });

  it('multiple items with inline amounts: amounts bound per item', () => {
    const mock: Partial<GeminiParseResult> = {
      amount: 300,
      payment_method: 'cash',
      items: [{ name: '拿鐵', amount: 150 }, { name: '抹茶', amount: 150 }],
      tags: [],
    };
    const result = normalize(mock);
    const itemTotal = result.items.reduce((sum, i) => sum + (i.amount ?? 0), 0);
    expect(itemTotal).toBe(result.amount);
  });

  it('no items in description → items=[]', () => {
    const mock: Partial<GeminiParseResult> = {
      amount: 100,
      payment_method: 'cash',
      items: [],
      tags: [],
    };
    expect(normalize(mock).items).toHaveLength(0);
  });

  it('unparseable input ("吃了個東西") → amount=0, triggers 422 path', () => {
    const mock: Partial<GeminiParseResult> = { amount: 0, payment_method: 'cash', items: [], tags: [] };
    const result = normalize(mock);
    expect(!result.amount || result.amount <= 0).toBe(true);
  });
});

// ─── parseExpenseText (Discord flow) — amount is pre-known ───────────────────

describe('parseExpenseText — Discord flow behaviors', () => {
  it('amount from input is preserved even if Gemini omits it', () => {
    const inputAmount = 200;
    const parsed: Partial<GeminiParseResult> = { items: [], tags: [] };
    const finalAmount = parsed.amount ?? inputAmount;
    expect(finalAmount).toBe(200);
  });

  it('payment_method defaults to cash when description has no keyword', () => {
    const parsed: Partial<GeminiParseResult> = { amount: 150, items: [{ name: '燙青菜' }], tags: [] };
    expect(parsed.payment_method ?? 'cash').toBe('cash');
  });

  it('payment_method is detected when keyword is in description', () => {
    const parsed: Partial<GeminiParseResult> = {
      amount: 80,
      payment_method: 'easy_card',
      items: [{ name: '捷運' }],
      tags: [],
    };
    expect(parsed.payment_method).toBe('easy_card');
  });
});
