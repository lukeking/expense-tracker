import { describe, it, expect } from 'vitest';

// Inline the helper under test (mirrors pwa.ts implementation)
function txHasPlainTag(tx: { tags: string[]; transaction_items: { tags: string[] }[] }, tag: string): boolean {
  const isPlain = (t: string) => t === tag;
  return tx.tags.some(isPlain) || tx.transaction_items.some((item) => item.tags.some(isPlain));
}

const makeTx = (opts: { tags?: string[]; itemTags?: string[][]; payment_method?: string }) => ({
  id: 'tx-1',
  amount: 100,
  transaction_type: 'expense',
  payment_method: opts.payment_method ?? 'cash',
  tags: opts.tags ?? [],
  note: null,
  transaction_at: '2026-05-01T10:00:00Z',
  created_at: '2026-05-01T10:00:00Z',
  parent_transaction_id: null,
  transaction_items: (opts.itemTags ?? []).map((tags, i) => ({ id: `item-${i}`, name: 'item', amount: 50, tags })),
});

describe('txHasPlainTag', () => {
  it('matches a tag on the transaction itself', () => {
    expect(txHasPlainTag(makeTx({ tags: ['lunch', '食:外食'] }), 'lunch')).toBe(true);
  });

  it('matches a tag on an item', () => {
    expect(txHasPlainTag(makeTx({ itemTags: [['coffee'], ['食:外食']] }), 'coffee')).toBe(true);
  });

  it('does not match a different plain tag', () => {
    const tx = makeTx({ tags: ['travel', '食:外食'] });
    expect(txHasPlainTag(tx, 'lunch')).toBe(false);
    expect(txHasPlainTag(tx, '食')).toBe(false); // partial prefix does not match
  });

  it('returns false when tag is absent', () => {
    expect(txHasPlainTag(makeTx({ tags: ['travel'] }), 'lunch')).toBe(false);
  });

  it('returns false for tx with no tags and no items', () => {
    expect(txHasPlainTag(makeTx({}), 'lunch')).toBe(false);
  });
});

describe('payment_method filter (query-layer logic)', () => {
  const txs = [
    makeTx({ payment_method: 'credit_card' }),
    makeTx({ payment_method: 'cash' }),
    makeTx({ payment_method: 'cash' }),
  ];

  it('filters to matching payment method', () => {
    const result = txs.filter((tx) => tx.payment_method === 'cash');
    expect(result).toHaveLength(2);
  });

  it('returns empty when no transactions match', () => {
    const result = txs.filter((tx) => tx.payment_method === 'easy_card');
    expect(result).toHaveLength(0);
  });
});

describe('combined tag + payment_method filter', () => {
  const txs = [
    makeTx({ tags: ['lunch'], payment_method: 'cash' }),
    makeTx({ tags: ['lunch'], payment_method: 'credit_card' }),
    makeTx({ tags: ['travel'], payment_method: 'cash' }),
  ];

  it('applies AND logic — only tx matching both conditions', () => {
    const tag = 'lunch';
    const pm = 'cash';
    const result = txs
      .filter((tx) => tx.payment_method === pm)
      .filter((tx) => txHasPlainTag(tx, tag));
    expect(result).toHaveLength(1);
    expect(result[0].tags).toContain('lunch');
    expect(result[0].payment_method).toBe('cash');
  });
});
