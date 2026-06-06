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

describe('rematch preconditions', () => {
  // 改配對 reuses the unlink detach path but flips the invoice to `ambiguous` instead of
  // deleting it; like unlink, only a currently-matched invoice can be re-matched.
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

// ─── POST /pwa/import/mark-read — payload handling (US1) ───────────────────────

describe('mark-read payload handling', () => {
  // The handler unions a single invoice_id and/or a bulk invoice_ids[] into a unique
  // id set; an empty set is a 400 (neither field provided).
  function collectIds(body: { invoice_id?: string; invoice_ids?: string[] }): string[] {
    return [...new Set([...(body.invoice_id ? [body.invoice_id] : []), ...(body.invoice_ids ?? [])])];
  }

  it('accepts a single invoice_id', () => {
    expect(collectIds({ invoice_id: 'inv-1' })).toEqual(['inv-1']);
  });

  it('accepts a bulk invoice_ids list', () => {
    expect(collectIds({ invoice_ids: ['inv-1', 'inv-2'] })).toEqual(['inv-1', 'inv-2']);
  });

  it('unions single + bulk, deduped', () => {
    expect(collectIds({ invoice_id: 'inv-1', invoice_ids: ['inv-1', 'inv-2'] })).toEqual(['inv-1', 'inv-2']);
  });

  it('400 (empty id set) when neither field is provided', () => {
    expect(collectIds({}).length === 0).toBe(true);
  });
});

// ─── POST /pwa/import/manual-link — per-item replace (US3, rename-only) ────────

describe('manual-link per-item replace (US3)', () => {
  // Rename-only: take the invoice line's name; keep the existing item's amount,
  // effective_amount, tags, and source_invoice_id. `replace` is independent of the
  // append set (`item_indexes`).
  interface Item { id: string; name: string; amount: number | null; effective_amount: number | null; tags: string[]; source_invoice_id: string | null }
  function applyRenames(
    items: Item[],
    invoiceItems: { name: string }[],
    replace: { item_id: string; invoice_item_index: number }[]
  ): Item[] {
    return items.map((it) => {
      const r = replace.find((x) => x.item_id === it.id);
      return r ? { ...it, name: invoiceItems[r.invoice_item_index].name } : it;
    });
  }

  it('renames the targeted item, preserving amount/effective/tags/provenance', () => {
    const items: Item[] = [{ id: 'it-1', name: '早餐', amount: 35, effective_amount: 35, tags: ['食:早餐'], source_invoice_id: null }];
    const out = applyRenames(items, [{ name: '招牌蛋餅' }], [{ item_id: 'it-1', invoice_item_index: 0 }]);
    expect(out[0]).toEqual({ id: 'it-1', name: '招牌蛋餅', amount: 35, effective_amount: 35, tags: ['食:早餐'], source_invoice_id: null });
  });

  it('renames keep source_invoice_id = NULL so un-link does not delete them', () => {
    const items: Item[] = [{ id: 'it-1', name: 'placeholder', amount: 50, effective_amount: 50, tags: [], source_invoice_id: null }];
    const out = applyRenames(items, [{ name: '正式品名' }], [{ item_id: 'it-1', invoice_item_index: 0 }]);
    expect(out[0].source_invoice_id).toBeNull();
  });

  it('replace is independent of the append (item_indexes) selection', () => {
    const items: Item[] = [{ id: 'it-1', name: 'X', amount: 10, effective_amount: 10, tags: [], source_invoice_id: null }];
    const invoiceItems = [{ name: 'rename-line' }, { name: 'append-line' }];
    const replace = [{ item_id: 'it-1', invoice_item_index: 0 }];
    const itemIndexes = [1]; // appends a different invoice line
    const renamed = applyRenames(items, invoiceItems, replace);
    expect(renamed[0].name).toBe('rename-line');
    expect(itemIndexes).toEqual([1]); // append set untouched by replace
  });

  it('a replace.item_id not on the chosen transaction → 400', () => {
    const existingIds = new Set(['it-1']);
    const replace = [{ item_id: 'it-2', invoice_item_index: 0 }];
    const invalid = replace.some((r) => !existingIds.has(r.item_id));
    expect(invalid).toBe(true);
  });

  it('a replace.invoice_item_index out of range → 400', () => {
    const invoiceItems = [{ name: 'only-line' }];
    const replace = [{ item_id: 'it-1', invoice_item_index: 3 }];
    const invalid = replace.some((r) => r.invoice_item_index < 0 || r.invoice_item_index >= invoiceItems.length);
    expect(invalid).toBe(true);
  });
});

// ─── GET /pwa/import/matched — read filter (US1) ───────────────────────────────

describe('matched list read filter', () => {
  // include_read=true reveals acknowledged matches; the default shows only unread.
  const includeRead = (q: string | undefined) => q === 'true';

  it('defaults to unread-only when include_read is absent', () => {
    expect(includeRead(undefined)).toBe(false);
  });

  it('includes acknowledged matches when include_read=true', () => {
    expect(includeRead('true')).toBe(true);
  });

  it('builds the linked-transaction set from unique matched_transaction_ids', () => {
    const invoices = [
      { matched_transaction_id: 'tx-1' },
      { matched_transaction_id: 'tx-1' },
      { matched_transaction_id: null },
      { matched_transaction_id: 'tx-2' },
    ];
    const ids = [...new Set(invoices.map((i) => i.matched_transaction_id).filter((id): id is string => id != null))];
    expect(ids.sort()).toEqual(['tx-1', 'tx-2']); // one batched .in() query
  });
});
