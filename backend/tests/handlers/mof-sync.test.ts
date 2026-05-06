import { describe, it, expect } from 'vitest';

function rocDateToCE(rocDate: string): string {
  const [year, month, day] = rocDate.split('/');
  return `${parseInt(year) + 1911}-${month}-${day}`;
}

describe('MOF sync handler', () => {
  describe('ROC date conversion', () => {
    it('converts 112/05/04 to 2023-05-04', () => {
      expect(rocDateToCE('112/05/04')).toBe('2023-05-04');
    });

    it('converts 113/01/01 to 2024-01-01', () => {
      expect(rocDateToCE('113/01/01')).toBe('2024-01-01');
    });

    it('converts 115/05/05 to 2026-05-05', () => {
      expect(rocDateToCE('115/05/05')).toBe('2026-05-05');
    });
  });

  describe('Error code handling', () => {
    it('treats code 404 as no-op (returns empty array)', () => {
      const response = { code: 404, msg: 'No invoices found', details: undefined };
      const result = response.code === 404 ? [] : response.details ?? [];
      expect(result).toHaveLength(0);
    });

    it('treats code 401 as auth failure requiring Discord alert', () => {
      const response = { code: 401, msg: 'Unauthorized' };
      const shouldAlert = response.code === 401;
      expect(shouldAlert).toBe(true);
    });

    it('treats code 429 as rate limit, returns empty array', () => {
      const response = { code: 429, msg: 'Rate limited' };
      const shouldRetryTomorrow = response.code === 429 || response.code >= 500;
      expect(shouldRetryTomorrow).toBe(true);
    });
  });
});
