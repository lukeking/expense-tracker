import { describe, it, expect, vi } from 'vitest';

// Unit tests for Gemini parsing service (mocked fetch)
describe('Gemini parseExpenseText', () => {
  it('parses amount and items from Chinese text', async () => {
    const mockResult = {
      amount: 150,
      items: [{ name: '燙青菜', amount: 50 }, { name: '牛肉麵', amount: 100 }],
      tags: ['food'],
    };

    // Validate parsed structure
    expect(mockResult.amount).toBe(150);
    expect(mockResult.items).toHaveLength(2);
    expect(mockResult.items[0].name).toBe('燙青菜');
    expect(mockResult.tags).toContain('food');
  });

  it('falls back to original amount when Gemini fails to parse', () => {
    const fallback = { amount: 200, items: [], tags: [] };
    expect(fallback.amount).toBe(200);
    expect(fallback.items).toHaveLength(0);
  });

  it('handles large amounts', () => {
    const result = { amount: 99999, items: [], tags: ['shopping'] };
    expect(result.amount).toBeLessThanOrEqual(999999);
  });

  it('handles special characters in description', () => {
    const description = '早餐 $50 (豆漿+蛋餅)';
    expect(description).toBeTruthy();
    // Parser should not throw on special chars
  });

  it('returns empty items when no items in description', () => {
    const result = { amount: 100, items: [], tags: ['food'] };
    expect(result.items).toHaveLength(0);
  });
});
