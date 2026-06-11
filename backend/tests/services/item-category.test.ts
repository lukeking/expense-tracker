import { describe, it, expect } from 'vitest';
import {
  EXPLICIT_UNCATEGORIZED,
  normalizeItemTagsOnWrite,
  itemWriteTags,
  promoteUnanimousCategory,
  planTransactionNormalization,
} from '../../src/services/item-category';
import { aggregateByCategory } from '../../src/services/summary';

// Feature 027 (B2): pure write-normalization + migration-planning rules. The handler
// glue applying them is thin and validated via quickstart, per the repo's test style.
// Note: EXPLICIT_UNCATEGORIZED must never be added to the categories catalog
// (backend/supabase/seed/categories.md) — it enters data only via the picker action.

describe('normalizeItemTagsOnWrite — FR-013 collapse', () => {
  it('drops an item tag equal to the tx category (collapse to inherit)', () => {
    expect(normalizeItemTagsOnWrite('食:雜貨', ['食:雜貨'])).toEqual([]);
  });

  it('keeps a differing category tag (genuine override)', () => {
    expect(normalizeItemTagsOnWrite('食:雜貨', ['樂:遊戲'])).toEqual(['樂:遊戲']);
  });

  it('passes the sentinel through untouched', () => {
    expect(normalizeItemTagsOnWrite('食:雜貨', [EXPLICIT_UNCATEGORIZED])).toEqual([EXPLICIT_UNCATEGORIZED]);
  });

  it('preserves plain tags alongside the collapse', () => {
    expect(normalizeItemTagsOnWrite('食:雜貨', ['全家', '食:雜貨'])).toEqual(['全家']);
  });

  it('is the identity when the tx has no category', () => {
    expect(normalizeItemTagsOnWrite(null, ['食:雜貨', '全家'])).toEqual(['食:雜貨', '全家']);
  });

  it('handles empty input', () => {
    expect(normalizeItemTagsOnWrite('食:雜貨', [])).toEqual([]);
    expect(normalizeItemTagsOnWrite(null, [])).toEqual([]);
  });
});

describe('itemWriteTags — PWA POST/PUT items[].tag shape', () => {
  it('null tag → inherit (stores nothing)', () => {
    expect(itemWriteTags('食:雜貨', null)).toEqual([]);
    expect(itemWriteTags(null, null)).toEqual([]);
  });

  it('tag equal to the tx category → collapsed to inherit', () => {
    expect(itemWriteTags('食:雜貨', '食:雜貨')).toEqual([]);
  });

  it('differing tag → stored as override', () => {
    expect(itemWriteTags('食:雜貨', '樂:遊戲')).toEqual(['樂:遊戲']);
  });

  it('sentinel → stored verbatim', () => {
    expect(itemWriteTags('食:雜貨', EXPLICIT_UNCATEGORIZED)).toEqual([EXPLICIT_UNCATEGORIZED]);
  });

  it('tag without tx category → stored (override of "no default")', () => {
    expect(itemWriteTags(null, '食:早餐')).toEqual(['食:早餐']);
  });
});

describe('promoteUnanimousCategory — FR-003/FR-009 promotion', () => {
  it('promotes a unanimous item category to tx level and collapses items', () => {
    const r = promoteUnanimousCategory(['全家'], [['食:早餐'], ['食:早餐', '7-11']]);
    expect(r.promoted).toBe('食:早餐');
    expect(r.txTags).toEqual(['食:早餐', '全家']);
    expect(r.itemTagsList).toEqual([[], ['7-11']]);
  });

  it('does not promote when the tx already has a category', () => {
    const r = promoteUnanimousCategory(['食:雜貨'], [['食:早餐'], ['食:早餐']]);
    expect(r.promoted).toBeNull();
    expect(r.txTags).toEqual(['食:雜貨']);
  });

  it('does not promote mixed categories', () => {
    expect(promoteUnanimousCategory([], [['食:早餐'], ['樂:遊戲']]).promoted).toBeNull();
  });

  it('does not promote when any item has no category (not unanimous)', () => {
    expect(promoteUnanimousCategory([], [['食:早餐'], []]).promoted).toBeNull();
  });

  it('never promotes the sentinel', () => {
    expect(promoteUnanimousCategory([], [[EXPLICIT_UNCATEGORIZED], [EXPLICIT_UNCATEGORIZED]]).promoted).toBeNull();
  });

  it('no-ops on an itemless transaction', () => {
    expect(promoteUnanimousCategory(['全家'], []).promoted).toBeNull();
  });
});

describe('planTransactionNormalization — migration transform', () => {
  it('strips item copies of the tx category (B1-era shape)', () => {
    const plan = planTransactionNormalization({
      tags: ['食:雜貨', '全家'],
      items: [{ tags: ['食:雜貨'] }, { tags: ['食:雜貨', '7-11'] }, { tags: ['樂:遊戲'] }],
    });
    expect(plan).not.toBeNull();
    expect(plan?.txTags).toEqual(['食:雜貨', '全家']);
    expect(plan?.itemTags).toEqual([[], ['7-11'], ['樂:遊戲']]);
  });

  it('promotes the unanimous category of a category-less tx (legacy inverse shape)', () => {
    const plan = planTransactionNormalization({
      tags: ['全家'],
      items: [{ tags: ['食:早餐'] }, { tags: ['食:早餐'] }],
    });
    expect(plan).not.toBeNull();
    expect(plan?.txTags).toEqual(['食:早餐', '全家']);
    expect(plan?.itemTags).toEqual([[], []]);
  });

  it('leaves mixed-category legacy transactions untouched (null plan)', () => {
    expect(planTransactionNormalization({
      tags: [],
      items: [{ tags: ['食:早餐'] }, { tags: ['樂:遊戲'] }],
    })).toBeNull();
  });

  it('leaves the sentinel untouched in both branches', () => {
    const plan = planTransactionNormalization({
      tags: ['食:雜貨'],
      items: [{ tags: ['食:雜貨'] }, { tags: [EXPLICIT_UNCATEGORIZED] }],
    });
    expect(plan?.itemTags).toEqual([[], [EXPLICIT_UNCATEGORIZED]]);
  });

  it('is idempotent: planning an already-normalized tx returns null', () => {
    expect(planTransactionNormalization({
      tags: ['食:雜貨', '全家'],
      items: [{ tags: [] }, { tags: ['樂:遊戲'] }],
    })).toBeNull();
    expect(planTransactionNormalization({ tags: [], items: [] })).toBeNull();
  });
});

// T023 guard scenario: the one shape where stripping a copy CHANGES totals — item
// amounts exceeding tx.amount (the negative remainder is dropped by aggregation, but
// item-tagged amounts are counted in full). The migration script must detect the
// bucket mismatch via aggregateByCategory and SKIP the transaction (research.md D3).
describe('total-preserving guard pathology (migration SKIP case)', () => {
  it('stripping a copy shifts buckets when item amounts exceed tx.amount → script must skip', () => {
    const before = {
      amount: 100,
      tags: ['食:雜貨'],
      transaction_items: [{ amount: 120, tags: ['食:雜貨'] }],
    };
    const plan = planTransactionNormalization({ tags: before.tags, items: [{ tags: ['食:雜貨'] }] });
    expect(plan).not.toBeNull(); // the transform alone would strip it…
    const after = { ...before, transaction_items: [{ amount: 120, tags: plan?.itemTags[0] ?? [] }] };
    // …but aggregation differs (食:120 → 食:100), so the guard rejects the plan.
    expect(aggregateByCategory([before])).not.toEqual(aggregateByCategory([after]));
  });

  it('the normal shape is total-preserving (guard passes)', () => {
    const before = {
      amount: 250,
      tags: ['食:雜貨'],
      transaction_items: [{ amount: 200, tags: ['食:雜貨'] }, { amount: 50, tags: ['樂:遊戲'] }],
    };
    const plan = planTransactionNormalization({ tags: before.tags, items: before.transaction_items.map((i) => ({ tags: i.tags })) });
    const after = { ...before, transaction_items: before.transaction_items.map((it, i) => ({ ...it, tags: plan?.itemTags[i] ?? [] })) };
    expect(aggregateByCategory([before])).toEqual(aggregateByCategory([after]));
  });
});
