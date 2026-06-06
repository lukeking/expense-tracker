import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPieChartUrl, fetchBarChartUrl } from '../../src/services/chart';

const QUICKCHART_URL = 'https://quickchart.io/chart/create';

describe('fetchPieChartUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to quickchart.io/chart/create and returns url on success', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://quickchart.io/chart/abc123' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const totals = [
      { category: '食', total: 500 },
      { category: '行', total: 200 },
    ];
    const url = await fetchPieChartUrl(totals);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe(QUICKCHART_URL);
    expect(calledInit.method).toBe('POST');

    const body = JSON.parse(calledInit.body as string);
    expect(body.type).toBe('pie');
    expect(body.data.labels).toEqual(['食', '行']);
    expect(body.data.datasets[0].data).toEqual([500, 200]);

    expect(url).toBe('https://quickchart.io/chart/abc123');
  });

  it('returns null (not throws) on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    const url = await fetchPieChartUrl([{ category: '食', total: 100 }]);
    expect(url).toBeNull();
  });

  it('returns null (not throws) on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const url = await fetchPieChartUrl([{ category: '食', total: 100 }]);
    expect(url).toBeNull();
  });

  it('returns null when response has no url field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'something' }),
    }));
    const url = await fetchPieChartUrl([{ category: '食', total: 100 }]);
    expect(url).toBeNull();
  });
});

describe('fetchBarChartUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs bar chart config with indexAxis=y to quickchart.io', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://quickchart.io/chart/bar456' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const totals = [
      { subcategory: '午餐', total: 8200 },
      { subcategory: '超市', total: 4140 },
    ];
    const url = await fetchBarChartUrl(totals, '食');

    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe(QUICKCHART_URL);
    expect(calledInit.method).toBe('POST');

    const body = JSON.parse(calledInit.body as string);
    expect(body.type).toBe('bar');
    expect(body.options.indexAxis).toBe('y');
    expect(body.data.labels).toEqual(['午餐', '超市']);
    expect(body.data.datasets[0].data).toEqual([8200, 4140]);

    expect(url).toBe('https://quickchart.io/chart/bar456');
  });

  it('returns null (not throws) on non-200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const url = await fetchBarChartUrl([{ subcategory: '午餐', total: 100 }], '食');
    expect(url).toBeNull();
  });

  it('returns null (not throws) on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const url = await fetchBarChartUrl([{ subcategory: '午餐', total: 100 }], '食');
    expect(url).toBeNull();
  });
});
