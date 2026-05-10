import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPieChartUrl, fetchBarChartUrl } from '../../src/services/chart';
import type { CategoryTotal, SubcategoryTotal } from '../../src/services/summary';

const PIE_TOTALS: CategoryTotal[] = [
  { category: '食', total: 5000 },
  { category: '行', total: 2000 },
];

const BAR_TOTALS: SubcategoryTotal[] = [
  { subcategory: '午餐', total: 3000 },
  { subcategory: '晚餐', total: 2000 },
];

describe('fetchPieChartUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('(a) returns URL string on 200 response with { url } body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 'https://quickchart.io/chart/abc123' }), { status: 200 })
    );
    const url = await fetchPieChartUrl(PIE_TOTALS);
    expect(url).toBe('https://quickchart.io/chart/abc123');
  });

  it('(b) returns null on non-200 status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('error', { status: 429 }));
    const url = await fetchPieChartUrl(PIE_TOTALS);
    expect(url).toBeNull();
  });

  it('(c) returns null when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'));
    const url = await fetchPieChartUrl(PIE_TOTALS);
    expect(url).toBeNull();
  });

  it('(f) POST body has correct type:pie and non-empty labels', async () => {
    let capturedBody: unknown;
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return new Response(JSON.stringify({ url: 'https://quickchart.io/chart/xyz' }), { status: 200 });
    });
    await fetchPieChartUrl(PIE_TOTALS);
    expect((capturedBody as { chart: { type: string; data: { labels: string[] } } }).chart.type).toBe('pie');
    expect((capturedBody as { chart: { type: string; data: { labels: string[] } } }).chart.data.labels).toEqual(['食', '行']);
  });

  it('returns null for empty totals without calling fetch', async () => {
    const url = await fetchPieChartUrl([]);
    expect(url).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('fetchBarChartUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('(d) returns URL on successful response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ url: 'https://quickchart.io/chart/bar123' }), { status: 200 })
    );
    const url = await fetchBarChartUrl(BAR_TOTALS, '食');
    expect(url).toBe('https://quickchart.io/chart/bar123');
  });

  it('(e) returns null on fetch failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'));
    const url = await fetchBarChartUrl(BAR_TOTALS, '食');
    expect(url).toBeNull();
  });

  it('(f) POST body has correct type:bar and subcategory labels', async () => {
    let capturedBody: unknown;
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}');
      return new Response(JSON.stringify({ url: 'https://quickchart.io/chart/bar456' }), { status: 200 });
    });
    await fetchBarChartUrl(BAR_TOTALS, '食');
    const chart = (capturedBody as { chart: { type: string; data: { labels: string[] } } }).chart;
    expect(chart.type).toBe('bar');
    expect(chart.data.labels).toEqual(['午餐', '晚餐']);
  });

  it('returns null for empty totals without calling fetch', async () => {
    const url = await fetchBarChartUrl([], '食');
    expect(url).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
