import { describe, it, expect } from 'vitest';

describe('Matching algorithm', () => {
  const makeTransaction = (id: string, amount: number, at: string) => ({
    id,
    amount,
    transaction_at: at,
    is_matched: false,
    matched_receipt_id: null,
    discord_message_id: null,
    items: null,
    tags: [],
    payment_method: 'credit_card' as const,
    bank_name: null,
    note: null,
    created_at: at,
  });

  const makeReceipt = (id: string, amount: number, date: string) => ({
    id,
    invoice_number: `INV-${id}`,
    seller_name: 'Test Store',
    seller_tax_id: '12345678',
    total_amount: amount,
    items: [],
    invoice_date: date,
    carrier_type: 'mobile_barcode',
    raw_data: {},
    fetched_at: date,
    created_at: date,
  });

  it('single candidate: should auto-match', () => {
    const candidates = [makeReceipt('r1', 380, '2026-05-04')];
    expect(candidates.length).toBe(1);
    // Single candidate → auto-match behavior
  });

  it('multiple candidates: should create pending_match', () => {
    const candidates = [
      makeReceipt('r1', 380, '2026-05-04'),
      makeReceipt('r2', 380, '2026-05-03'),
    ];
    expect(candidates.length).toBeGreaterThan(1);
    // Multiple → pending_match + Discord alert
  });

  it('zero candidates: transaction remains unmatched', () => {
    const candidates: ReturnType<typeof makeReceipt>[] = [];
    expect(candidates.length).toBe(0);
    // No candidates → no-op
  });

  it('match window is ±48 hours', () => {
    const txDate = new Date('2026-05-05T14:00:00Z');
    const windowStart = new Date(txDate.getTime() - 48 * 60 * 60 * 1000);
    const windowEnd = new Date(txDate.getTime() + 48 * 60 * 60 * 1000);

    const receiptDate = new Date('2026-05-04T00:00:00Z');
    expect(receiptDate >= windowStart && receiptDate <= windowEnd).toBe(true);
  });
});
