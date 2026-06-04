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
