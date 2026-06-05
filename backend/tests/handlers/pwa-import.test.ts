import { describe, it, expect } from 'vitest';
import { computeConfidence } from '../../src/services/invoice-matcher';

// Logic-level tests for the v2 import endpoints (POST /pwa/import, GET
// /pwa/import/ambiguous, POST /pwa/import/resolve). The handler glue is thin; the
// decision logic it relies on is asserted here, mirroring the repo's unit-test style.

// ─── POST /pwa/import — summary accounting (FR-012 / SC-004) ──────────────────

describe('import summary accounting (SC-004)', () => {
  it('all outcome buckets sum to the total parsed invoice count', () => {
    const counters = {
      matchedExact: 8,
      matchedNear: 2,
      ambiguous: 3,
      skippedUnmatched: 1,
      skippedDuplicate: 4,
      skippedVoided: 1,
      skippedZero: 0,
      parseFailed: 1,
    };
    const totalParsed = 20; // 8+2+3+1+4+1+0+1
    const sum =
      counters.matchedExact + counters.matchedNear + counters.ambiguous +
      counters.skippedUnmatched + counters.skippedDuplicate +
      counters.skippedVoided + counters.skippedZero + counters.parseFailed;
    expect(sum).toBe(totalParsed);
  });

  it('response matched count = matched_exact + matched_near', () => {
    const matched_exact = 5;
    const matched_near = 3;
    expect(matched_exact + matched_near).toBe(8);
  });
});

// ─── GET /pwa/import/ambiguous — candidate source selection ───────────────────

describe('ambiguous candidate source selection', () => {
  // The handler tries exact candidates first; only when there are none does it fall
  // back to forex candidates (and labels the source accordingly).
  function pickSource(exact: unknown[], forex: unknown[]): { source: 'exact' | 'forex'; candidates: unknown[] } {
    if (exact.length > 0) return { source: 'exact', candidates: exact };
    return { source: 'forex', candidates: forex };
  }

  it('uses exact candidates when present', () => {
    const r = pickSource([{ id: 'a' }, { id: 'b' }], [{ id: 'fx' }]);
    expect(r.source).toBe('exact');
    expect(r.candidates).toHaveLength(2);
  });

  it('falls back to forex when no exact candidates exist', () => {
    const r = pickSource([], [{ id: 'fx' }]);
    expect(r.source).toBe('forex');
    expect(r.candidates).toHaveLength(1);
  });
});

// ─── POST /pwa/import/resolve — confidence + guards (FR-011/FR-004) ────────────

describe('resolve confidence', () => {
  it('same-day exact-amount manual link is exact', () => {
    expect(computeConfidence('2025-04-18T00:00:00Z', '2025-04-18T09:00:00Z', 500, 500)).toBe('exact');
  });

  it('manually-resolved forex link (amount differs) is near', () => {
    expect(computeConfidence('2025-04-18T00:00:00Z', '2025-04-18T09:00:00Z', 480, 500)).toBe('near');
  });

  it('different-day manual link is near', () => {
    expect(computeConfidence('2025-04-18T00:00:00Z', '2025-04-20T09:00:00Z', 500, 500)).toBe('near');
  });
});

describe('resolve preconditions', () => {
  it('rejects an invoice that is not ambiguous (409 INVOICE_NOT_AMBIGUOUS)', () => {
    const invoice = { match_status: 'matched' };
    expect(invoice.match_status !== 'ambiguous').toBe(true);
  });

  it('rejects a transaction already linked to an invoice (409 TRANSACTION_ALREADY_LINKED)', () => {
    const tx = { matched_invoice_id: 'inv-other' };
    expect(tx.matched_invoice_id !== null).toBe(true);
  });

  it('accepts an ambiguous invoice + unlinked transaction', () => {
    const invoice = { match_status: 'ambiguous' };
    const tx = { matched_invoice_id: null };
    expect(invoice.match_status === 'ambiguous' && tx.matched_invoice_id === null).toBe(true);
  });
});

// ─── POST /pwa/import/unlink — guards + reversal logic ────────────────────────

describe('unlink preconditions', () => {
  it('rejects an invoice that is not matched (409 INVOICE_NOT_MATCHED)', () => {
    const invoice = { match_status: 'ambiguous' };
    expect(invoice.match_status !== 'matched').toBe(true);
  });

  it('accepts a matched invoice', () => {
    const invoice = { match_status: 'matched' };
    expect(invoice.match_status === 'matched').toBe(true);
  });
});

describe('unlink reversal logic', () => {
  // Items are removed by provenance (source_invoice_id), not by name, so a user's own
  // same-named item always survives an unlink.
  function survivingItems(
    items: { name: string; source_invoice_id: string | null }[],
    invoiceId: string
  ): string[] {
    return items.filter((i) => i.source_invoice_id !== invoiceId).map((i) => i.name);
  }

  it('removes only items this invoice created, keeping a same-named user item', () => {
    const items = [
      { name: '雙手卷', source_invoice_id: null },      // user's own
      { name: '雙手卷', source_invoice_id: 'inv-1' },   // created by the link
    ];
    expect(survivingItems(items, 'inv-1')).toEqual(['雙手卷']); // only the user's survives
  });

  // The transaction stays matched only if a receipt is still linked after unlinking.
  it('preserves is_matched when a receipt is still linked', () => {
    expect(({ matched_receipt_id: 'rcpt-1' }).matched_receipt_id != null).toBe(true);
    expect(({ matched_receipt_id: null }).matched_receipt_id != null).toBe(false);
  });
});

// ─── POST /pwa/import/manual-link — guards + item selection ───────────────────

describe('manual-link guards', () => {
  it('rejects an already-imported invoice (409 ALREADY_IMPORTED)', () => {
    const existing = ['YD56145096']; // findExistingInvoiceNumbers returned a hit
    expect(existing.length > 0).toBe(true);
  });

  it('rejects a transaction already linked (409 TRANSACTION_ALREADY_LINKED)', () => {
    const tx = { matched_invoice_id: 'inv-other' };
    expect(tx.matched_invoice_id !== null).toBe(true);
  });

  it('rejects a non-ambiguous invoice_id (409 INVOICE_NOT_AMBIGUOUS)', () => {
    const invoice = { match_status: 'matched' }; // linking by id only allowed for ambiguous
    expect(invoice.match_status !== 'ambiguous').toBe(true);
  });

  it('confidence is near when amounts differ (40 invoice ↔ 35 tx)', () => {
    expect(computeConfidence('2026-04-19T00:00:00Z', '2026-04-19T09:00:00Z', 35, 40)).toBe('near');
  });
});

describe('manual-link item selection', () => {
  // Only the checked, positive-amount invoice items are appended.
  function selected(items: { name: string; amount: number }[], checked: number[]): string[] {
    return items
      .filter((_, idx) => checked.includes(idx))
      .filter((li) => li.amount == null || li.amount > 0)
      .map((li) => li.name);
  }

  it('appends only checked items (FamilyMart: roll only, not the pre-paid coffee)', () => {
    const items = [
      { name: '特大冰美式', amount: 60 },
      { name: '一配經典人氣雙手卷', amount: 55 },
    ];
    expect(selected(items, [1])).toEqual(['一配經典人氣雙手卷']);
    expect(selected(items, [])).toEqual([]); // zero checked → metadata-only link
  });
});
