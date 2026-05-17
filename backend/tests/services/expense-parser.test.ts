import { describe, it, expect } from 'vitest';
import { parseTags, parseItems } from '../../src/services/expense-parser';

// ─── parseTags ────────────────────────────────────────────────────────────────

describe('parseTags', () => {
  it('null/undefined/empty → all empty, no error', () => {
    expect(parseTags(null)).toEqual({ plainTags: [], sharedCategory: null, error: null });
    expect(parseTags(undefined)).toEqual({ plainTags: [], sharedCategory: null, error: null });
    expect(parseTags('')).toEqual({ plainTags: [], sharedCategory: null, error: null });
    expect(parseTags('  ')).toEqual({ plainTags: [], sharedCategory: null, error: null });
  });

  it('single plain tag → plainTags', () => {
    expect(parseTags('#麥當勞')).toEqual({ plainTags: ['麥當勞'], sharedCategory: null, error: null });
  });

  it('multiple plain tags → all in plainTags', () => {
    expect(parseTags('#麥當勞,#7-11')).toEqual({ plainTags: ['麥當勞', '7-11'], sharedCategory: null, error: null });
  });

  it('single shared category → sharedCategory set', () => {
    expect(parseTags('#食:午餐')).toEqual({ plainTags: [], sharedCategory: '食:午餐', error: null });
  });

  it('plain tag + shared category → both set', () => {
    expect(parseTags('#麥當勞,#食:午餐')).toEqual({ plainTags: ['麥當勞'], sharedCategory: '食:午餐', error: null });
  });

  it('two shared categories → error', () => {
    const result = parseTags('#食:午餐,#住:租金');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('#住:租金');
  });

  it('non-# token → error', () => {
    const result = parseTags('麥當勞');
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('麥當勞');
  });

  it('spaces around commas are trimmed', () => {
    expect(parseTags(' #麥當勞 , #食:午餐 ')).toEqual({ plainTags: ['麥當勞'], sharedCategory: '食:午餐', error: null });
  });
});

// ─── parseItems ───────────────────────────────────────────────────────────────

describe('parseItems — empty / no description', () => {
  it('null description, no sharedCategory → empty items', () => {
    expect(parseItems(null, 120, null)).toEqual({ items: [], warnings: [], error: null });
  });

  it('null description, with sharedCategory → implicit item from subcategory', () => {
    expect(parseItems(null, 120, '食:午餐')).toEqual({
      items: [{ name: '午餐', amount: 120, tags: ['食:午餐'] }],
      warnings: [],
      error: null,
    });
  });

  it('empty string description, with sharedCategory → implicit item', () => {
    expect(parseItems('  ', 35, '行:捷運')).toEqual({
      items: [{ name: '捷運', amount: 35, tags: ['行:捷運'] }],
      warnings: [],
      error: null,
    });
  });
});

describe('parseItems — sole item amount inference', () => {
  it('#x:y bare (sole) → item name=subcategory, amount=total', () => {
    expect(parseItems('#食:午餐', 120, null)).toEqual({
      items: [{ name: '午餐', amount: 120, tags: ['食:午餐'] }],
      warnings: [],
      error: null,
    });
  });

  it('#x:y name (sole, no amount) → amount inferred from total', () => {
    expect(parseItems('#食:午餐 便當', 120, null)).toEqual({
      items: [{ name: '便當', amount: 120, tags: ['食:午餐'] }],
      warnings: [],
      error: null,
    });
  });

  it('untagged name amount (sole) → amount explicit, tags from sharedCategory', () => {
    expect(parseItems('便當 120', 120, '食:午餐')).toEqual({
      items: [{ name: '便當', amount: 120, tags: ['食:午餐'] }],
      warnings: [],
      error: null,
    });
  });

  it('untagged bare name (sole, no amount) → amount inferred, tags from sharedCategory', () => {
    expect(parseItems('便當', 120, '食:午餐')).toEqual({
      items: [{ name: '便當', amount: 120, tags: ['食:午餐'] }],
      warnings: [],
      error: null,
    });
  });
});

describe('parseItems — explicit item token (#x:y name amount)', () => {
  it('single explicit item', () => {
    expect(parseItems('#食:早餐 便當 60', 60, null)).toEqual({
      items: [{ name: '便當', amount: 60, tags: ['食:早餐'] }],
      warnings: [],
      error: null,
    });
  });

  it('multiple fully specified items', () => {
    expect(parseItems('#食:早餐 便當 60,#醫:藥 感冒藥 120', 180, null)).toEqual({
      items: [
        { name: '便當', amount: 60, tags: ['食:早餐'] },
        { name: '感冒藥', amount: 120, tags: ['醫:藥'] },
      ],
      warnings: [],
      error: null,
    });
  });
});

describe('parseItems — null-amount items (multi-item)', () => {
  it('two #x:y name items (no amounts) → both null', () => {
    const result = parseItems('#食:零食 薯片,#住:日用品 洗髮精', 200, null);
    expect(result.items).toEqual([
      { name: '薯片', amount: undefined, tags: ['食:零食'] },
      { name: '洗髮精', amount: undefined, tags: ['住:日用品'] },
    ]);
    expect(result.error).toBeNull();
  });

  it('mixed: one with amount, one without → no-amount stays null', () => {
    const result = parseItems('#食:早餐 便當 60,#醫:藥 感冒藥', 180, null);
    expect(result.items).toEqual([
      { name: '便當', amount: 60, tags: ['食:早餐'] },
      { name: '感冒藥', amount: undefined, tags: ['醫:藥'] },
    ]);
    expect(result.error).toBeNull();
  });
});

describe('parseItems — untagged items with sharedCategory', () => {
  it('multiple untagged items inherit sharedCategory', () => {
    expect(parseItems('大麥克 200,可樂 50', 250, '食:午餐')).toEqual({
      items: [
        { name: '大麥克', amount: 200, tags: ['食:午餐'] },
        { name: '可樂', amount: 50, tags: ['食:午餐'] },
      ],
      warnings: [],
      error: null,
    });
  });

  it('untagged items without sharedCategory → empty tags', () => {
    expect(parseItems('大麥克 200,可樂 50', 250, null)).toEqual({
      items: [
        { name: '大麥克', amount: 200, tags: [] },
        { name: '可樂', amount: 50, tags: [] },
      ],
      warnings: [],
      error: null,
    });
  });

  it('mixed: own-tagged item ignores sharedCategory, untagged item inherits it', () => {
    const result = parseItems('#飲:飲料 可樂 50,薯條 50', 100, '食:午餐');
    expect(result.items).toEqual([
      { name: '可樂', amount: 50, tags: ['飲:飲料'] },
      { name: '薯條', amount: 50, tags: ['食:午餐'] },
    ]);
  });
});

describe('parseItems — hard reject cases', () => {
  it('bare #x:y mixed with other item tokens → error', () => {
    const result = parseItems('#食:午餐,#醫:藥 感冒藥 120', 180, null);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('純分類標籤');
  });

  it('bare #x:y mixed with untagged item → error', () => {
    const result = parseItems('#食:午餐,便當 60', 120, null);
    expect(result.error).toBeTruthy();
  });

  it('#x (no colon) in description → error directing to tags field', () => {
    const result = parseItems('#麥當勞', 100, null);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('tags 欄位');
  });

  it('items sum > totalAmount → error', () => {
    const result = parseItems('#食:午餐 便當 100,#飲:飲料 可樂 80', 150, null);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('NT$180');
    expect(result.error).toContain('NT$150');
  });

  it('items sum equals total → no error', () => {
    expect(parseItems('#食:午餐 便當 60,#醫:藥 藥 60', 120, null).error).toBeNull();
  });

  it('items sum less than total → no error (remainder falls to 其他)', () => {
    expect(parseItems('#食:午餐 便當 60', 120, null).error).toBeNull();
  });
});
