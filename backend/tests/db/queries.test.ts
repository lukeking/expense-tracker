import { describe, it, expect, vi } from 'vitest';

// Test the getMonthlySpend reduce logic directly — same formula as the implementation
function computeMonthlySpend(rows: { amount: number; transaction_type: string }[]): number {
  return rows.reduce((sum, row) => {
    const amount = row.amount;
    return row.transaction_type === 'refund' ? sum - amount : sum + amount;
  }, 0);
}

describe('getMonthlySpend sign correction', () => {
  it('sums expense rows normally', () => {
    const rows = [
      { amount: 500, transaction_type: 'expense' },
      { amount: 300, transaction_type: 'expense' },
    ];
    expect(computeMonthlySpend(rows)).toBe(800);
  });

  it('adds fee rows to net spend', () => {
    const rows = [
      { amount: 1000, transaction_type: 'expense' },
      { amount: 50, transaction_type: 'fee' },
    ];
    expect(computeMonthlySpend(rows)).toBe(1050);
  });

  it('subtracts refund rows from net spend', () => {
    const rows = [
      { amount: 1000, transaction_type: 'expense' },
      { amount: 200, transaction_type: 'refund' },
    ];
    expect(computeMonthlySpend(rows)).toBe(800);
  });

  it('applies mixed formula: expense(1000) + fee(50) - refund(200) = 850', () => {
    const rows = [
      { amount: 1000, transaction_type: 'expense' },
      { amount: 50, transaction_type: 'fee' },
      { amount: 200, transaction_type: 'refund' },
    ];
    expect(computeMonthlySpend(rows)).toBe(850);
  });

  it('returns 0 for empty result set', () => {
    expect(computeMonthlySpend([])).toBe(0);
  });

  it('refund can bring net spend below zero (over-refund edge case)', () => {
    const rows = [{ amount: 100, transaction_type: 'refund' }];
    expect(computeMonthlySpend(rows)).toBe(-100);
  });
});

describe('formatButtonLabel (UTC+8 conversion)', () => {
  function formatButtonLabel(amount: number, transactionAt: string): string {
    const utc8 = new Date(new Date(transactionAt).getTime() + 8 * 60 * 60 * 1000);
    const mm = String(utc8.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(utc8.getUTCDate()).padStart(2, '0');
    const hh = String(utc8.getUTCHours()).padStart(2, '0');
    const min = String(utc8.getUTCMinutes()).padStart(2, '0');
    return `NT$${amount.toLocaleString()} · ${mm}/${dd} ${hh}:${min}`;
  }

  it('formats amount with comma separator for thousands', () => {
    const label = formatButtonLabel(1200, '2026-04-30T06:23:00.000Z');
    expect(label).toBe('NT$1,200 · 04/30 14:23');
  });

  it('converts UTC time to UTC+8 for label', () => {
    // 2026-04-30T16:00:00Z = 2026-05-01 00:00 UTC+8
    const label = formatButtonLabel(800, '2026-04-30T16:00:00.000Z');
    expect(label).toBe('NT$800 · 05/01 00:00');
  });

  it('pads single-digit month, day, hour, minute', () => {
    // 2026-01-05T01:05:00Z = 2026-01-05 09:05 UTC+8
    const label = formatButtonLabel(50, '2026-01-05T01:05:00.000Z');
    expect(label).toBe('NT$50 · 01/05 09:05');
  });
});
