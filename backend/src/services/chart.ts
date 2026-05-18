import type { CategoryTotal, SubcategoryTotal } from '../types';

const QUICKCHART_URL = 'https://quickchart.io/chart/create';
const PIE_COLORS = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#C9CBCF'];

async function postChart(payload: unknown): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(QUICKCHART_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchPieChartUrl(totals: CategoryTotal[]): Promise<string | null> {
  return postChart({
    type: 'pie',
    data: {
      labels: totals.map((t) => t.category),
      datasets: [{ data: totals.map((t) => t.total), backgroundColor: PIE_COLORS }],
    },
    options: {
      plugins: {
        legend: { position: 'right' },
        datalabels: {
          formatter: "(v,c) => c.chart.data.labels[c.dataIndex] + '\\nNT$' + v.toLocaleString()",
        },
      },
    },
  });
}

export async function fetchBarChartUrl(
  totals: SubcategoryTotal[],
  _category: string
): Promise<string | null> {
  return postChart({
    type: 'bar',
    data: {
      labels: totals.map((t) => t.subcategory),
      datasets: [{ label: 'NT$', data: totals.map((t) => t.total), backgroundColor: '#36A2EB' }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: "v => 'NT$' + v.toLocaleString()" } } },
    },
  });
}
