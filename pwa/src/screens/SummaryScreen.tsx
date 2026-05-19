import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { TimeWindowPicker } from '../components/TimeWindowPicker';
import { useSummaryData, useSubcategoryData, useTransactions } from '../hooks/useSummary';
import type { WindowOption, TxRecord } from '../hooks/useSummary';

const COLOURS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

function formatMoney(val: number) {
  return `NT$${val.toLocaleString()}`;
}

function groupTransactions(txs: TxRecord[], window: WindowOption): { label: string; items: TxRecord[] }[] {
  const groups = new Map<string, TxRecord[]>();
  const UTC8 = 8 * 60 * 60 * 1000;

  for (const tx of txs) {
    const utc8 = new Date(new Date(tx.transaction_at).getTime() + UTC8);
    let key: string;
    if (window === 'month' || window === 'last-month' || window === '3months') {
      key = utc8.toISOString().slice(0, 10);
    } else if (window === 'half-year' || window === 'year') {
      const y = utc8.getUTCFullYear();
      const weekNum = Math.ceil(utc8.getUTCDate() / 7);
      key = `${y}/${utc8.getUTCMonth() + 1} 第${weekNum}週`;
    } else {
      key = `${utc8.getUTCFullYear()}/${String(utc8.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(tx);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([label, items]) => ({ label, items }));
}

function txLabel(tx: TxRecord): string {
  const note = tx.note;
  const itemTags = tx.items?.flatMap((i) => i.tags ?? []) ?? [];
  const tags = [...tx.tags, ...itemTags];
  const tag = tags.find((t) => !t.includes(':')) ?? tags.find((t) => t.includes(':'))?.split(':')[1];
  const name = tx.items?.[0]?.name;
  const label = (tag && note) ? `${tag}(${note})` : (note ?? tag ?? name ?? tx.transaction_type);
  return label;
}

function HistoryGroup({ label, items, parentMap }: { label: string; items: TxRecord[]; parentMap: Map<string, TxRecord> }) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((s, t) => s + t.amount, 0);

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center px-4 py-3 text-sm"
      >
        <span className="font-medium text-gray-700">{label}</span>
        <span className="text-gray-500">{formatMoney(total)} {open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="pb-2">
          {items.map((tx) => (
            <div key={tx.id} className="px-4 py-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-gray-700">{txLabel(tx)}</span>
                <span className="font-medium">{formatMoney(tx.amount)}</span>
              </div>
              {tx.parent_transaction_id && (
                <p className="text-xs text-gray-400 mt-0.5">
                  ↳ {parentMap.has(tx.parent_transaction_id)
                    ? `${txLabel(parentMap.get(tx.parent_transaction_id)!)} ${formatMoney(parentMap.get(tx.parent_transaction_id)!.amount)}`
                    : '已連結原始交易'}
                </p>
              )}
              {tx.items.length > 0 && (
                <div className="mt-1 space-y-0.5 pl-2">
                  {tx.items.map((item) => (
                    <div key={item.id} className="flex justify-between text-xs text-gray-400">
                      <span>{item.name}</span>
                      {item.amount !== null && <span>NT${item.amount}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SummaryScreen() {
  const [window, setWindow] = useState<WindowOption>('month');
  const [drilldown, setDrilldown] = useState<string | null>(null);

  const { data: summaryData, isLoading: summaryLoading } = useSummaryData(window);
  const { data: subData, isLoading: subLoading } = useSubcategoryData(drilldown, window);
  const { data: txData } = useTransactions(window, drilldown);

  const txs = txData?.transactions ?? [];
  const groups = groupTransactions(txs, window);
  const parentMap = new Map(txs.map((tx) => [tx.id, tx]));

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="pt-4 pb-2">
        <TimeWindowPicker value={window} onChange={(w) => { setWindow(w); setDrilldown(null); }} />
      </div>

      {drilldown ? (
        /* ── Drilldown view ── */
        <div className="flex-1">
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100">
            <button type="button" onClick={() => setDrilldown(null)} className="text-blue-600 text-sm">
              ← 返回
            </button>
            <span className="font-semibold text-gray-800">{drilldown}</span>
            {subData && <span className="ml-auto text-sm text-gray-500">{formatMoney(subData.total)}</span>}
          </div>
          {subLoading ? (
            <div className="p-8 text-center text-gray-400">載入中…</div>
          ) : subData && subData.subcategories.length > 0 ? (
            <div className="px-4 py-3">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={subData.subcategories.map((s) => ({ name: s.subcategory, total: s.total }))}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} />
                  <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-400">此期間無子分類資料</div>
          )}
        </div>
      ) : (
        /* ── Main view ── */
        <div className="flex-1">
          {summaryLoading ? (
            <div className="p-8 text-center text-gray-400">載入中…</div>
          ) : !summaryData || summaryData.categories.length === 0 ? (
            <div className="p-8 text-center text-gray-400">此期間無支出記錄</div>
          ) : (
            <>
              <div className="text-center py-2">
                <span className="text-xs text-gray-500">總計</span>
                <p className="text-2xl font-bold text-gray-900">{formatMoney(summaryData.grand_total)}</p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={summaryData.categories.map((c) => ({ name: c.category, value: c.total }))}
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    dataKey="value"
                    onClick={(entry) => setDrilldown(entry.name as string)}
                    cursor="pointer"
                    label={({ name, percent }) => `${name} ${Math.round((percent as number) * 100)}%`}
                    labelLine={false}
                  >
                    {summaryData.categories.map((_, i) => (
                      <Cell key={i} fill={COLOURS[i % COLOURS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => formatMoney(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="px-4 pb-2">
                {summaryData.categories.map((c, i) => (
                  <button
                    key={c.category}
                    type="button"
                    onClick={() => setDrilldown(c.category)}
                    className="flex items-center gap-2 w-full py-1.5 text-sm"
                  >
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: COLOURS[i % COLOURS.length] }} />
                    <span className="flex-1 text-left text-gray-700">{c.category}</span>
                    <span className="text-gray-500">{c.percentage}%</span>
                    <span className="font-medium text-gray-800">{formatMoney(c.total)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Transaction history */}
      <div className="border-t border-gray-100">
        <div className="px-4 py-2">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">交易記錄</span>
        </div>
        {groups.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-4">此期間無交易</p>
        ) : (
          groups.map((g) => <HistoryGroup key={g.label} label={g.label} items={g.items} parentMap={parentMap} />)
        )}
      </div>
    </div>
  );
}
