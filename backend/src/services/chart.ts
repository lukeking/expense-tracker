import type { CategoryTotal, SubcategoryTotal } from './summary';

const QUICKCHART_URL = 'https://quickchart.io/chart/create';
const PIE_COLORS = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#C9CBCF'];

async function postToQuickChart(chartConfig: object): Promise<string | null> {
  try {
    const res = await fetch(QUICKCHART_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chart: chartConfig }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { url?: string };
    return data.url ?? null;
  } catch {
    return null;
  }
}

export async function fetchPieChartUrl(totals: CategoryTotal[]): Promise<string | null> {
  if (totals.length === 0) return null;
  const chartConfig = {
    type: 'pie',
    data: {
      labels: totals.map((c) => c.category),
      datasets: [{
        data: totals.map((c) => c.total),
        backgroundColor: PIE_COLORS.slice(0, totals.length),
      }],
    },
    options: {
      plugins: {
        legend: { position: 'right' },
        datalabels: {
          formatter: "(v,c) => c.chart.data.labels[c.dataIndex] + '\\nNT$' + v.toLocaleString()",
        },
      },
    },
  };
  return postToQuickChart(chartConfig);
}

export async function fetchBarChartUrl(totals: SubcategoryTotal[], category: string): Promise<string | null> {
  if (totals.length === 0) return null;
  const chartConfig = {
    type: 'bar',
    data: {
      labels: totals.map((s) => s.subcategory),
      datasets: [{
        label: `${category} NT$`,
        data: totals.map((s) => s.total),
        backgroundColor: '#36A2EB',
      }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { callback: "v => 'NT$' + v.toLocaleString()" } },
      },
    },
  };
  return postToQuickChart(chartConfig);
}
