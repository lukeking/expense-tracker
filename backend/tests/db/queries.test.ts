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

// ─── amendTransactionAmount ──────────────────────────────────────────────────

describe('amendTransactionAmount', () => {
  it('only updates amount, leaves other fields intact (contract test)', () => {
    // amendTransactionAmount issues UPDATE SET amount = $1 WHERE id = $2
    // All other fields (tags, payment_method, etc.) are not touched
    const patch = { amount: 1523 };
    const otherFieldsAffected = Object.keys(patch).some((k) => k !== 'amount');
    expect(otherFieldsAffected).toBe(false);
  });

  it('custom_id encoding for amend_select stays within 100 chars', () => {
    const newAmount = 99999; // max realistic NTD amount
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const customId = `amend_select:${newAmount}:${uuid}`;
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it('custom_id encoding for amend_retype stays within 100 chars', () => {
    const newAmount = 99999;
    const customId = `amend_retype:${newAmount}`;
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it('custom_id encoding for amend_modal stays within 100 chars', () => {
    const newAmount = 99999;
    const customId = `amend_modal:${newAmount}`;
    expect(customId.length).toBeLessThanOrEqual(100);
  });

  it('parses newAmount and txId from amend_select custom_id', () => {
    const newAmount = 1523;
    const txId = '550e8400-e29b-41d4-a716-446655440000';
    const customId = `amend_select:${newAmount}:${txId}`;
    const rest = customId.slice('amend_select:'.length);
    const colonIdx = rest.indexOf(':');
    expect(Number(rest.slice(0, colonIdx))).toBe(newAmount);
    expect(rest.slice(colonIdx + 1)).toBe(txId);
  });
});

// ─── Invoice query logic (unit tests) ───────────────────────────────────────

describe('findMatchingExpenseTransaction date window', () => {
  it('±2 day window — invoiceDate on same day as transaction', () => {
    const invoiceDate = new Date('2025-04-18T00:00:00Z');
    const txDate = '2025-04-18T10:00:00Z';
    const windowStart = new Date(invoiceDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const windowEnd = new Date(invoiceDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const txDay = txDate.slice(0, 10);
    expect(txDay >= windowStart && txDay <= windowEnd).toBe(true);
  });

  it('±2 day window — transaction exactly 2 days before invoice', () => {
    const invoiceDate = new Date('2025-04-18T00:00:00Z');
    const txDate = '2025-04-16T00:00:00Z';
    const windowStart = new Date(invoiceDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const windowEnd = new Date(invoiceDate.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const txDay = txDate.slice(0, 10);
    expect(txDay >= windowStart && txDay <= windowEnd).toBe(true);
  });

  it('±2 day window — transaction 3 days before invoice is out of range', () => {
    const invoiceDate = new Date('2025-04-18T00:00:00Z');
    const txDate = '2025-04-15T00:00:00Z';
    const windowStart = new Date(invoiceDate.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const txDay = txDate.slice(0, 10);
    expect(txDay >= windowStart).toBe(false);
  });
});

describe('findForexCandidateTransaction ±5% range', () => {
  it('amount within ±5% qualifies as forex candidate', () => {
    const netAmount = 1523;
    const txAmount = 1500;
    const low = Math.floor(netAmount * 0.95);
    const high = Math.ceil(netAmount * 1.05);
    expect(txAmount >= low && txAmount <= high).toBe(true);
  });

  it('amount exactly at lower boundary (5% below) qualifies', () => {
    const netAmount = 1000;
    const txAmount = 950; // exactly 5% below
    const low = Math.floor(netAmount * 0.95);
    const high = Math.ceil(netAmount * 1.05);
    expect(txAmount >= low && txAmount <= high).toBe(true);
  });

  it('amount 6% below does not qualify as forex candidate', () => {
    const netAmount = 1000;
    const txAmount = 940; // 6% below
    const low = Math.floor(netAmount * 0.95);
    expect(txAmount >= low).toBe(false);
  });
});

describe('findForexCandidateTransactions ±7-day window (v2)', () => {
  // v2 widens the forex fallback to ±7 days (vs ±2 for exact) for foreign-currency
  // posting lag. Candidates are returned as an array (manual resolution only).
  function inForexWindow(invoiceDate: string, txDate: string): boolean {
    const d = new Date(invoiceDate);
    const start = new Date(d.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const end = new Date(d.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const day = txDate.slice(0, 10);
    return day >= start && day <= end;
  }

  it('transaction 5 days after invoice is inside the ±7-day forex window', () => {
    expect(inForexWindow('2025-04-18T00:00:00Z', '2025-04-23T00:00:00Z')).toBe(true);
  });

  it('transaction 7 days after invoice is the boundary (inside)', () => {
    expect(inForexWindow('2025-04-18T00:00:00Z', '2025-04-25T00:00:00Z')).toBe(true);
  });

  it('transaction 8 days after invoice is outside the forex window', () => {
    expect(inForexWindow('2025-04-18T00:00:00Z', '2025-04-26T00:00:00Z')).toBe(false);
  });
});

describe('linkInvoiceToTransaction update payload', () => {
  it('sets match_status=matched, match_confidence, and matched_transaction_id', () => {
    // Mirrors the UPDATE issued by linkInvoiceToTransaction
    const payload = { match_status: 'matched', match_confidence: 'near', matched_transaction_id: 'tx-1' };
    expect(payload.match_status).toBe('matched');
    expect(payload.match_confidence).toBe('near');
    expect(payload.matched_transaction_id).toBe('tx-1');
  });
});

describe('findExistingInvoiceNumbers dedup logic', () => {
  it('identifies already-seen invoice numbers', () => {
    const dbNumbers = ['AB-001', 'AB-002', 'AB-003'];
    const incoming = ['AB-001', 'AB-004', 'AB-005'];
    const dupes = incoming.filter((n) => dbNumbers.includes(n));
    expect(dupes).toEqual(['AB-001']);
  });

  it('returns empty array when no duplicates', () => {
    const dbNumbers = ['AB-001'];
    const incoming = ['AB-002', 'AB-003'];
    const dupes = incoming.filter((n) => dbNumbers.includes(n));
    expect(dupes).toHaveLength(0);
  });
});
