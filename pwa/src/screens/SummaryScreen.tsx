import { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { SummaryNav } from '../components/SummaryNav';
import { PeriodPicker } from '../components/PeriodPicker';
import { FilterBar } from '../components/FilterBar';
import { useSummaryData, useSubcategoryData, useTransactions, useTransactionPeriods, useMonthTransactions } from '../hooks/useSummary';
import type { TimeBase, TxRecord, PeriodData } from '../hooks/useSummary';
import { EditExpenseSheet } from '../components/EditExpenseSheet';

const COLOURS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

function formatMoney(val: number) {
  return `NT$${val.toLocaleString()}`;
}

function localDt(isoStr: string, opts: { date?: boolean; time?: boolean } = { date: true, time: true }): string {
  const d = new Date(isoStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (opts.date && opts.time) return `${date} ${time}`;
  if (opts.date) return date;
  return time;
}

function groupTransactions(txs: TxRecord[], base: TimeBase): { label: string; items: TxRecord[] }[] {
  const groups = new Map<string, TxRecord[]>();

  for (const tx of txs) {
    const dt = new Date(tx.transaction_at);
    let key: string;
    if (base === 'week' || base === 'month') {
      key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    } else {
      key = `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
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

function TxEntry({ tx, parentMap, onEdit }: { tx: TxRecord; parentMap: Map<string, TxRecord>; onEdit?: (id: string) => void }) {
  return (
    <div className="px-4 py-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-gray-700 dark:text-gray-200">
          {txLabel(tx)}
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5">{localDt(tx.transaction_at, { time: true })}</span>
        </span>
        <span className="flex items-center gap-2">
          {tx.transaction_type === 'expense' && onEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(tx.id); }}
              className="text-xs text-blue-500 hover:text-blue-700"
              aria-label="編輯"
            >
              ✏
            </button>
          )}
          <span className={`font-medium ${tx.transaction_type === 'refund' ? 'text-green-600' : 'text-gray-800 dark:text-gray-100'}`}>
            {tx.transaction_type === 'refund' ? `-${formatMoney(tx.amount)}` : formatMoney(tx.amount)}
          </span>
        </span>
      </div>
      {tx.parent_transaction_id && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          ↳ {parentMap.has(tx.parent_transaction_id)
            ? `${txLabel(parentMap.get(tx.parent_transaction_id)!)} ${formatMoney(parentMap.get(tx.parent_transaction_id)!.amount)}`
            : '已連結原始交易'}
          {' · '}於 {localDt(tx.created_at)} 實際{tx.transaction_type === 'refund' ? '退款' : '計費'}
        </p>
      )}
      {tx.items.length > 0 && (
        <div className="mt-1 space-y-0.5 pl-2">
          {tx.items.map((item) => (
            <div key={item.id} className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
              <span>{item.name}</span>
              {item.amount !== null && <span>NT${item.amount}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DateSubGroup({ dateLabel, items, parentMap, onEdit }: { dateLabel: string; items: TxRecord[]; parentMap: Map<string, TxRecord>; onEdit?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((s, t) => s + (t.transaction_type === 'refund' ? -t.amount : t.amount), 0);
  return (
    <div className="border-t border-gray-50 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center pl-8 pr-4 py-2 text-sm"
      >
        <span className="text-gray-500 dark:text-gray-400">{dateLabel}</span>
        <span className="text-gray-400 dark:text-gray-500">{formatMoney(total)} {open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="ml-4 border-l-2 border-gray-200 dark:border-gray-700 mb-1">
          {items.map((tx) => <TxEntry key={tx.id} tx={tx} parentMap={parentMap} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  );
}

function HistoryGroup({ label, items, parentMap, showDateSubs, onEdit }: { label: string; items: TxRecord[]; parentMap: Map<string, TxRecord>; showDateSubs?: boolean; onEdit?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((s, t) => s + (t.transaction_type === 'refund' ? -t.amount : t.amount), 0);

  const dateGroups = showDateSubs ? (() => {
    const map = new Map<string, TxRecord[]>();
    for (const tx of items) {
      const dt = new Date(tx.transaction_at);
      const key = `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tx);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  })() : null;

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center px-4 py-3 text-sm"
      >
        <span className="font-medium text-gray-700 dark:text-gray-200">{label}</span>
        <span className="text-gray-500 dark:text-gray-400">{formatMoney(total)} {open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="pb-2">
          {dateGroups
            ? dateGroups.map(([d, txs]) => <DateSubGroup key={d} dateLabel={d} items={txs} parentMap={parentMap} onEdit={onEdit} />)
            : items.map((tx) => <TxEntry key={tx.id} tx={tx} parentMap={parentMap} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  );
}

function LazyHistoryGroup({ period, onEdit }: { period: PeriodData; onEdit?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: txData, isLoading } = useMonthTransactions(period.from_date, period.to_date, open);

  const txs = txData?.transactions ?? [];
  const parentMap = new Map(txs.map((tx) => [tx.id, tx]));
  const dateGroups = (() => {
    const map = new Map<string, TxRecord[]>();
    for (const tx of txs) {
      const dt = new Date(tx.transaction_at);
      const key = `${String(dt.getMonth() + 1).padStart(2, '0')}/${String(dt.getDate()).padStart(2, '0')}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(tx);
    }
    return Array.from(map.entries()).sort(([a], [b]) => b.localeCompare(a));
  })();

  return (
    <div className="border-b border-gray-100 dark:border-gray-700 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between items-center px-4 py-3 text-sm"
      >
        <span className="font-medium text-gray-700 dark:text-gray-200">{period.period}</span>
        <span className="text-gray-500 dark:text-gray-400">{formatMoney(period.total)} {open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="pb-2">
          {isLoading
            ? <div className="px-4 py-2 text-sm text-gray-400 dark:text-gray-500">載入中…</div>
            : dateGroups.map(([d, txs]) => <DateSubGroup key={d} dateLabel={d} items={txs} parentMap={parentMap} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  );
}

export function SummaryScreen() {
  const [timeBase, setTimeBase] = useState<TimeBase>('week');
  const [offset, setOffset] = useState(0);
  const [tag, setTag] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);

  const handleTimeBaseChange = (base: TimeBase) => {
    setTimeBase(base);
    setOffset(0);
    setDrilldown(null);
    // filters preserved per FR-010; filter bar hidden automatically when base==='all'
  };

  const handleNavigate = (delta: -1 | 1) => {
    setOffset((o) => o + delta);
    setTag(null);
    setPaymentMethod(null);
    setDrilldown(null);
  };

  const handlePickerSelect = (newOffset: number) => {
    setOffset(newOffset);
    setTag(null);
    setPaymentMethod(null);
    setPickerOpen(false);
    setDrilldown(null);
  };

  const { data: summaryData, isLoading: summaryLoading } = useSummaryData(timeBase, offset, tag, paymentMethod);
  const { data: subData, isLoading: subLoading } = useSubcategoryData(drilldown, timeBase, offset, tag, paymentMethod);
  const { data: txData } = useTransactions(timeBase, offset, drilldown, tag, paymentMethod);
  const { data: periods } = useTransactionPeriods(timeBase);

  // Unfiltered tx fetch for filter bar chip population
  const { data: allTxData } = useTransactions(timeBase, offset);
  const availableTags = useMemo(() => {
    const txs = allTxData?.transactions ?? [];
    const set = new Set<string>();
    for (const tx of txs) {
      for (const t of tx.tags) { if (!t.includes(':')) set.add(t); }
      for (const item of tx.items) {
        for (const t of item.tags) { if (!t.includes(':')) set.add(t); }
      }
    }
    return Array.from(set).sort();
  }, [allTxData]);

  const availablePaymentMethods = useMemo(() => {
    const txs = allTxData?.transactions ?? [];
    return Array.from(new Set(txs.map((tx) => tx.payment_method))).sort();
  }, [allTxData]);

  const txs = txData?.transactions ?? [];
  const groups = groupTransactions(txs, timeBase);
  const parentMap = new Map(txs.map((tx) => [tx.id, tx]));

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {editingTxId && <EditExpenseSheet txId={editingTxId} onClose={() => setEditingTxId(null)} />}
      {pickerOpen && timeBase !== 'all' && (
        <PeriodPicker
          timeBase={timeBase}
          currentOffset={offset}
          onSelect={handlePickerSelect}
          onClose={() => setPickerOpen(false)}
        />
      )}

      <SummaryNav
        timeBase={timeBase}
        offset={offset}
        onTimeBaseChange={handleTimeBaseChange}
        onNavigate={handleNavigate}
        onPickerOpen={() => setPickerOpen(true)}
      />

      {timeBase !== 'all' && (
        <FilterBar
          tags={availableTags}
          paymentMethods={availablePaymentMethods}
          activeTag={tag}
          activePayment={paymentMethod}
          onTagChange={setTag}
          onPaymentChange={setPaymentMethod}
        />
      )}

      {drilldown ? (
        /* ── Drilldown view ── */
        <div>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-700">
            <button type="button" onClick={() => setDrilldown(null)} className="text-blue-600 text-sm">
              ← 返回
            </button>
            <span className="font-semibold text-gray-800 dark:text-gray-100">{drilldown}</span>
            {subData && <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">{formatMoney(subData.total)}</span>}
          </div>
          {subLoading ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">載入中…</div>
          ) : subData && subData.subcategories.length > 0 ? (
            <div className="px-4 py-3">
              <ResponsiveContainer width="100%" height={subData.subcategories.length * 44}>
                <BarChart
                  data={subData.subcategories.map((s) => ({ name: s.subcategory, total: s.total }))}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                >
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} />
                  <Bar dataKey="total" fill="#3b82f6" radius={[0, 4, 4, 0]} minPointSize={6} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">此期間無子分類資料</div>
          )}
        </div>
      ) : (
        /* ── Main view ── */
        <div>
          {summaryLoading ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">載入中…</div>
          ) : !summaryData || summaryData.categories.length === 0 ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">此期間無支出記錄</div>
          ) : (
            <>
              <div className="text-center py-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">總計</span>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">{formatMoney(summaryData.grand_total)}</p>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart margin={{ top: 20, right: 20, bottom: 0, left: 20 }}>
                  <Pie
                    data={summaryData.categories.map((c) => ({ name: c.category, value: c.total }))}
                    cx="50%"
                    cy="52%"
                    outerRadius={85}
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
                    <span className="flex-1 text-left text-gray-700 dark:text-gray-200">{c.category}</span>
                    <span className="text-gray-500 dark:text-gray-400">{c.percentage}%</span>
                    <span className="font-medium text-gray-800 dark:text-gray-100">{formatMoney(c.total)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Transaction history */}
      <div className="border-t border-gray-100 dark:border-gray-700">
        <div className="px-4 py-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">交易記錄</span>
        </div>
        {timeBase === 'all' ? (
          periods === undefined
            ? <div className="p-4 text-center text-gray-400 dark:text-gray-500 text-sm">載入中…</div>
            : periods.length === 0
              ? <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-4">此期間無交易</p>
              : periods.map((p) => <LazyHistoryGroup key={p.period} period={p} onEdit={setEditingTxId} />)
        ) : groups.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-4">此期間無交易</p>
        ) : (
          groups.map((g) => (
            <HistoryGroup
              key={g.label}
              label={g.label}
              items={g.items}
              parentMap={parentMap}
              showDateSubs={timeBase === 'year'}
              onEdit={setEditingTxId}
            />
          ))
        )}
      </div>
    </div>
  );
}
