import { describe, it, expect } from 'vitest';

// Inline the helper under test (mirrors pwa.ts implementation)
function distinctNotes(notes: (string | null)[], limit = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of notes) {
    const note = raw?.trim();
    if (note && !seen.has(note)) {
      seen.add(note);
      out.push(note);
      if (out.length >= limit) break;
    }
  }
  return out;
}

describe('distinctNotes', () => {
  it('preserves input order (most-recent-first) and dedupes', () => {
    expect(distinctNotes(['國外交易服務費', '跨行轉帳手續費', '國外交易服務費']))
      .toEqual(['國外交易服務費', '跨行轉帳手續費']);
  });

  it('drops null, empty, and whitespace-only notes', () => {
    expect(distinctNotes([null, '  ', '訂單退款', ''])).toEqual(['訂單退款']);
  });

  it('trims surrounding whitespace and dedupes on the trimmed value', () => {
    expect(distinctNotes(['  訂單退款 ', '訂單退款'])).toEqual(['訂單退款']);
  });

  it('caps the result at the limit', () => {
    const notes = Array.from({ length: 50 }, (_, i) => `note-${i}`);
    expect(distinctNotes(notes, 30)).toHaveLength(30);
  });

  it('returns an empty array when there are no usable notes', () => {
    expect(distinctNotes([null, '', '   '])).toEqual([]);
  });
});
