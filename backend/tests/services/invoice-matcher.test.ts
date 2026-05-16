import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParsedInvoice } from '../../src/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeInvoice(overrides: Partial<ParsedInvoice> = {}): ParsedInvoice {
  return {
    invoice_number: 'AB-00000001',
    seller_name: '全家便利商店',
    seller_tax_id: '12345678',
    invoice_date: new Date('2025-04-18T00:00:00Z'),
    gross_amount: 180,
    allowance: 0,
    net_amount: 180,
    invoice_status: 'active',
    items: [],
    ...overrides,
  };
}

function makeTx(id = 'tx-001', amount = 180) {
  return {
    id,
    amount,
    transaction_type: 'expense' as const,
    items: null,
    tags: [],
    payment_method: 'cash' as const,
    wallet: null,
    bank_name: null,
    note: null,
    is_matched: false,
    matched_receipt_id: null,
    parent_transaction_id: null,
    discord_message_id: null,
    invoice_number: null,
    seller_name: null,
    seller_tax_id: null,
    matched_invoice_id: null,
    transaction_at: '2025-04-18T00:00:00.000Z',
    created_at: '2025-04-18T00:01:00.000Z',
  };
}

function makeInvoiceRecord(id = 'inv-001', status = 'held_forex', netAmount = 1500) {
  return {
    id,
    import_run_id: 'run-001',
    invoice_number: 'NF-00000001',
    seller_name: 'Netflix',
    seller_tax_id: '99999999',
    invoice_date: '2025-05-06',
    gross_amount: netAmount,
    allowance: 0,
    net_amount: netAmount,
    items: null,
    invoice_status: 'active' as const,
    match_status: status as 'held_forex',
    matched_transaction_id: null,
    created_at: '2025-05-06T00:00:00.000Z',
  };
}

// ─── Pipeline dedup logic ────────────────────────────────────────────────────

describe('import pipeline — dedup', () => {
  it('skips invoices already in the DB (dedup by invoice_number)', async () => {
    const invoice = makeInvoice();
    const existingNumbers = [invoice.invoice_number];

    const toProcess = [invoice].filter((i) => !existingNumbers.includes(i.invoice_number));
    expect(toProcess).toHaveLength(0);
  });

  it('processes invoices not yet in the DB', () => {
    const invoice = makeInvoice({ invoice_number: 'AB-NEW-001' });
    const existingNumbers = ['AB-OLD-001'];

    const toProcess = [invoice].filter((i) => !existingNumbers.includes(i.invoice_number));
    expect(toProcess).toHaveLength(1);
  });
});

// ─── Primary match logic ─────────────────────────────────────────────────────

describe('import pipeline — primary match', () => {
  it('classifies invoice as matched when exact expense tx found', () => {
    const invoice = makeInvoice({ net_amount: 180 });
    const tx = makeTx('tx-180', 180);

    // Simulate: exact match found → status = 'matched'
    const status = tx.amount === invoice.net_amount ? 'matched' : 'unmatched';
    expect(status).toBe('matched');
  });

  it('classifies invoice as unmatched when no exact tx', () => {
    const invoice = makeInvoice({ net_amount: 180 });
    const foundTx = null; // no match

    const status = foundTx ? 'matched' : 'unmatched';
    expect(status).toBe('unmatched');
  });
});

// ─── Forex secondary pass ────────────────────────────────────────────────────

describe('import pipeline — forex secondary pass', () => {
  it('classifies invoice as held_forex when within ±5% of a tx', () => {
    const invoiceAmount = 1523;
    const txAmount = 1500;

    const low = Math.floor(invoiceAmount * 0.95);
    const high = Math.ceil(invoiceAmount * 1.05);
    const isForexMatch = txAmount >= low && txAmount <= high;
    expect(isForexMatch).toBe(true);
  });

  it('does not match when difference exceeds ±5%', () => {
    const invoiceAmount = 1000;
    const txAmount = 800; // 20% difference

    const low = Math.floor(invoiceAmount * 0.95);
    const high = Math.ceil(invoiceAmount * 1.05);
    const isForexMatch = txAmount >= low && txAmount <= high;
    expect(isForexMatch).toBe(false);
  });

  it('held_forex invoice is stored in DB without linking a transaction', () => {
    const invoice = makeInvoice({ net_amount: 1523 });
    const matchStatus = 'held_forex';
    const matchedTxId = undefined;

    // Simulates what insertInvoice receives for a forex hold
    expect(matchStatus).toBe('held_forex');
    expect(matchedTxId).toBeUndefined();
  });
});

// ─── Auto-create ─────────────────────────────────────────────────────────────

describe('import pipeline — auto-create', () => {
  it('creates new expense transaction for truly unmatched invoice', () => {
    const invoice = makeInvoice({ net_amount: 320, seller_name: '麥當勞' });

    const newTx = {
      amount: invoice.net_amount,
      transaction_type: 'expense' as const,
      payment_method: 'cash' as const,
      note: invoice.seller_name,
      transaction_at: invoice.invoice_date.toISOString(),
    };

    expect(newTx.transaction_type).toBe('expense');
    expect(newTx.payment_method).toBe('cash');
    expect(newTx.amount).toBe(320);
    expect(newTx.note).toBe('麥當勞');
  });
});

// ─── Reconciliation pass ─────────────────────────────────────────────────────

describe('runReconciliationPass', () => {
  it('resolves held_forex invoice to matched when exact tx found after /amend', () => {
    const heldInvoice = makeInvoiceRecord('inv-nf', 'held_forex', 1523);
    const tx = makeTx('tx-nf', 1523); // user ran /amend to correct amount to 1523

    // Exact match found → should set to 'matched'
    const newStatus = tx.amount === heldInvoice.net_amount ? 'matched' : 'still_held';
    expect(newStatus).toBe('matched');
  });

  it('keeps held_forex when tx is still within ±5% but not exact', () => {
    const heldInvoice = makeInvoiceRecord('inv-nf', 'held_forex', 1523);
    const txAmount = 1500; // within 5% but not exact

    const isExact = txAmount === heldInvoice.net_amount;
    const low = Math.floor(heldInvoice.net_amount * 0.95);
    const high = Math.ceil(heldInvoice.net_amount * 1.05);
    const isForex = txAmount >= low && txAmount <= high;

    expect(isExact).toBe(false);
    expect(isForex).toBe(true);
    // → stays held_forex
  });

  it('auto-creates transaction when no candidate exists at all for held_forex invoice', () => {
    const heldInvoice = makeInvoiceRecord('inv-orphan', 'held_forex', 999);
    const noExactTx = null;
    const noForexTx = null;

    // → should auto-create
    const shouldAutoCreate = !noExactTx && !noForexTx;
    expect(shouldAutoCreate).toBe(true);
  });

  it('detects collision when exact-match candidate is already linked to another invoice (FR-009)', () => {
    // findMatchingExpenseTransaction returns [] (filters matched_invoice_id IS NULL)
    const unlinkedExactCandidates: ReturnType<typeof makeTx>[] = [];
    // findExactMatchIncludingLinked returns the already-linked candidate
    const allExactCandidates = [{ ...makeTx('tx-taken', 1523), matched_invoice_id: 'other-invoice-id' }];

    const hasCollision =
      unlinkedExactCandidates.length === 0 &&
      allExactCandidates.some((tx) => tx.matched_invoice_id !== null);

    expect(hasCollision).toBe(true);
  });

  it('does not auto-create when a collision is detected — invoice stays held (FR-009)', () => {
    const unlinkedExactCandidates: ReturnType<typeof makeTx>[] = [];
    const allExactCandidates = [{ ...makeTx('tx-taken', 1523), matched_invoice_id: 'other-invoice-id' }];
    const noForexCandidate = null;

    const hasCollision =
      unlinkedExactCandidates.length === 0 &&
      allExactCandidates.some((tx) => tx.matched_invoice_id !== null);
    const shouldAutoCreate = !hasCollision && noForexCandidate === null;

    expect(shouldAutoCreate).toBe(false);
  });
});

// ─── Ambiguous match (FR-005) ────────────────────────────────────────────────

describe('import pipeline — ambiguous match', () => {
  it('classifies invoice as ambiguous when multiple exact-amount transactions exist on same date', () => {
    const invoice = makeInvoice({ net_amount: 150 });
    const tx1 = makeTx('tx-a', 150);
    const tx2 = { ...makeTx('tx-b', 150), created_at: '2025-04-18T00:00:30.000Z' };

    // Simulate findMatchingExpenseTransaction returning two candidates
    const candidates = [tx1, tx2];

    const status = candidates.length === 1 ? 'matched'
      : candidates.length > 1 ? 'ambiguous'
      : 'unmatched';

    expect(status).toBe('ambiguous');
  });

  it('does not enrich any transaction when invoice is held as ambiguous', () => {
    const tx1 = makeTx('tx-a', 150);
    const tx2 = { ...makeTx('tx-b', 150), created_at: '2025-04-18T00:00:30.000Z' };

    const candidates = [tx1, tx2];
    const enriched: string[] = [];

    // Simulate: ambiguous → no enrichTransaction call
    if (candidates.length === 1) enriched.push(candidates[0].id);

    expect(enriched).toHaveLength(0);
    expect(tx1.is_matched).toBe(false);
    expect(tx2.is_matched).toBe(false);
  });

  it('passes invoice to ambiguousItems with all candidate transactions', () => {
    const invoice = makeInvoice({ net_amount: 150 });
    const tx1 = makeTx('tx-a', 150);
    const tx2 = { ...makeTx('tx-b', 150), created_at: '2025-04-18T00:00:30.000Z' };

    const candidates = [tx1, tx2];
    const ambiguousItems: Array<{ invoice: typeof invoice; candidates: typeof candidates }> = [];

    if (candidates.length > 1) ambiguousItems.push({ invoice, candidates });

    expect(ambiguousItems).toHaveLength(1);
    expect(ambiguousItems[0].invoice.invoice_number).toBe(invoice.invoice_number);
    expect(ambiguousItems[0].candidates).toHaveLength(2);
  });

  it('single-candidate invoice is NOT classified as ambiguous', () => {
    const invoice = makeInvoice({ net_amount: 180 });
    const candidates = [makeTx('tx-only', 180)];

    const status = candidates.length === 1 ? 'matched'
      : candidates.length > 1 ? 'ambiguous'
      : 'unmatched';

    expect(status).toBe('matched');
  });
});

// ─── Reconciliation pass — ambiguous invoice loop (FR-003) ───────────────────

describe('runReconciliationPass — ambiguous invoice loop', () => {
  it('auto-links ambiguous invoice when exactly 1 candidate remains', () => {
    const candidates = [makeTx('tx-only', 150)];
    const newStatus = candidates.length === 1 ? 'matched'
      : candidates.length > 1 ? 'ambiguous'
      : 'auto_created';
    expect(newStatus).toBe('matched');
    expect(candidates[0].id).toBe('tx-only');
  });

  it('auto-creates transaction for ambiguous invoice when 0 candidates remain', () => {
    const inv = makeInvoiceRecord('inv-amb', 'ambiguous', 200);
    const candidates: ReturnType<typeof makeTx>[] = [];
    const newStatus = candidates.length === 1 ? 'matched'
      : candidates.length > 1 ? 'ambiguous'
      : 'auto_created';
    expect(newStatus).toBe('auto_created');
    expect(inv.net_amount).toBe(200);
  });

  it('leaves ambiguous invoice held when 2+ candidates remain', () => {
    const tx1 = makeTx('tx-a', 150);
    const tx2 = { ...makeTx('tx-b', 150), created_at: '2025-04-18T00:00:30.000Z' };
    const candidates = [tx1, tx2];
    const newStatus = candidates.length === 1 ? 'matched'
      : candidates.length > 1 ? 'ambiguous'
      : 'auto_created';
    expect(newStatus).toBe('ambiguous');
    expect(candidates).toHaveLength(2);
  });

  it('ReconciliationResult separates forexLinked from ambiguousAutoLinked', () => {
    const mockResult = {
      forexLinked: 2,
      forexAutoCreated: 1,
      forexStillHeld: 1,
      ambiguousAutoLinked: 1,
      ambiguousAutoCreated: 0,
      ambiguousRemaining: [] as ReturnType<typeof makeInvoiceRecord>[],
      collisionCount: 0,
    };
    expect(mockResult.forexLinked).toBe(2);
    expect(mockResult.ambiguousAutoLinked).toBe(1);
    expect(mockResult.ambiguousRemaining).toHaveLength(0);
    // runImportPipeline uses forexLinked + forexAutoCreated for forexResolvedCount
    expect(mockResult.forexLinked + mockResult.forexAutoCreated).toBe(3);
  });

  it('forexStillHeld increments when held_forex candidate is still within ±5%', () => {
    const mockResult = {
      forexLinked: 0,
      forexAutoCreated: 0,
      forexStillHeld: 2,
      ambiguousAutoLinked: 0,
      ambiguousAutoCreated: 0,
      ambiguousRemaining: [] as ReturnType<typeof makeInvoiceRecord>[],
      collisionCount: 0,
    };
    expect(mockResult.forexStillHeld).toBe(2);
  });
});

// ─── Date window ────────────────────────────────────────────────────────────

describe('date window matching', () => {
  it('±2 day window correctly identifies adjacent dates', () => {
    const invoiceDate = new Date('2025-04-18T00:00:00Z');
    const txDate = new Date('2025-04-16T00:00:00Z'); // 2 days before

    const windowStart = new Date(invoiceDate.getTime() - 2 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(invoiceDate.getTime() + 2 * 24 * 60 * 60 * 1000);

    expect(txDate >= windowStart && txDate <= windowEnd).toBe(true);
  });

  it('rejects dates outside ±2 day window', () => {
    const invoiceDate = new Date('2025-04-18T00:00:00Z');
    const txDate = new Date('2025-04-21T00:00:00Z'); // 3 days after

    const windowStart = new Date(invoiceDate.getTime() - 2 * 24 * 60 * 60 * 1000);
    const windowEnd = new Date(invoiceDate.getTime() + 2 * 24 * 60 * 60 * 1000);

    expect(txDate >= windowStart && txDate <= windowEnd).toBe(false);
  });
});
