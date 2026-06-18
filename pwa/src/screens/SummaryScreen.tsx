import { useState, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts';
import { SummaryNav } from '../components/SummaryNav';
import { PeriodPicker } from '../components/PeriodPicker';
import { FilterBar } from '../components/FilterBar';
import { useSummaryData, useSubcategoryData, useTransactions, useTransactionPeriods, useMonthTransactions } from '../hooks/useSummary';
import type { TimeBase, TxRecord, PeriodData } from '../hooks/useSummary';
import { useTags } from '../hooks/useTags';
import { EditExpenseSheet } from '../components/EditExpenseSheet';
import { useQueryClient } from '@tanstack/react-query';
import { ItemCategorySheet } from '../components/ItemCategorySheet';
import { assignItemCategory } from '../api/client';
import { itemCategoryTag, effectiveItemCategory } from '../lib/itemCategory';
import { txInSubcategory, itemInSubcategory, subAmount } from '../lib/subcategory';
import { useT } from '../i18n';

const COLOURS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

// The all-time view doesn't bulk-load transactions, so its payment-method chips come from this full
// list rather than being derived from the in-view rows (as week/month/year do).
const ALL_PAYMENT_METHODS = ['credit_card', 'cash', 'easy_card', 'prepaid_wallet', 'bank_account'];

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

// Feature 030: when a subcategory bar is selected, every amount shown in the drilldown
// list (rows, day subtotals, header) is the net subcategory portion (matching items'
// effective_amount) rather than the whole-transaction amount.
type SubFilter = { major: string; sub: string } | null;

function txSignedAmount(tx: TxRecord, subFilter: SubFilter): number {
  if (subFilter) return subAmount(tx, subFilter.major, subFilter.sub); // already refund-signed
  return tx.transaction_type === 'refund' ? -tx.amount : tx.amount;
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

function TxEntry({ tx, parentMap, subFilter, onEdit }: { tx: TxRecord; parentMap: Map<string, TxRecord>; subFilter?: SubFilter; onEdit?: (id: string) => void }) {
  const qc = useQueryClient();
  const t = useT();
  // Feature 026: the item being categorized inline from the Summary list.
  const [catItem, setCatItem] = useState<{ itemId: string; value: string | null } | null>(null);
  const canCategorize = tx.transaction_type === 'expense';
  const inheritedTag = tx.tags.find((t) => t.includes(':')) ?? null;
  // Feature 030: under a subcategory filter, show only the matching item lines and the
  // net subcategory amount for the row; otherwise the whole transaction.
  const filter = subFilter ?? null;
  const displayItems = filter ? tx.items.filter((i) => itemInSubcategory(i, tx, filter.major, filter.sub)) : tx.items;
  const rowMagnitude = filter ? Math.abs(subAmount(tx, filter.major, filter.sub)) : tx.amount;

  async function assignCategory(catTag: string | null) {
    if (!catItem) return;
    try {
      await assignItemCategory(tx.id, catItem.itemId, catTag);
      // Re-aggregate: the item's spend moves between the 'Other' bucket and its category.
      for (const key of ['summary', 'subcategories', 'transactions', 'tx-month']) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    } catch {
      // Leave as-is on failure; the user can retry.
    }
  }

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
              aria-label={t('common.edit')}
            >
              ✏
            </button>
          )}
          <span className={`font-medium ${tx.transaction_type === 'refund' ? 'text-green-600' : 'text-gray-800 dark:text-gray-100'}`}>
            {tx.transaction_type === 'refund' ? `-${formatMoney(rowMagnitude)}` : formatMoney(rowMagnitude)}
          </span>
        </span>
      </div>
      {tx.parent_transaction_id && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          ↳ {parentMap.has(tx.parent_transaction_id)
            ? `${txLabel(parentMap.get(tx.parent_transaction_id)!)} ${formatMoney(parentMap.get(tx.parent_transaction_id)!.amount)}`
            : t('summary.linkedOriginal')}
          {' · '}{tx.transaction_type === 'refund'
            ? t('summary.actualRefund', { date: localDt(tx.created_at) })
            : t('summary.actualCharge', { date: localDt(tx.created_at) })}
        </p>
      )}
      {displayItems.length > 0 && (
        <div className="mt-1 space-y-0.5 pl-2">
          {displayItems.map((item) => {
            const cat = itemCategoryTag(item);
            const itemAmt = filter ? (item.effective_amount ?? item.amount) : item.amount;
            // B2 (FR-011): show the effective category — blue = own decision
            // (override / sentinel-as-'Other'), pale gray = inherited live from the tx,
            // amber ⚠ = no decision anywhere.
            const eff = effectiveItemCategory(item, tx);
            const inner = (
              <>
                <span className="text-gray-400 dark:text-gray-500">
                  {item.name}
                  {eff.source === 'override' || eff.source === 'explicit-uncategorized' ? (
                    <span className="text-blue-500 dark:text-blue-400"> #{eff.tag}</span>
                  ) : eff.source === 'inherited' ? (
                    <span className="text-gray-300 dark:text-gray-600"> #{eff.tag}</span>
                  ) : canCategorize ? (
                    <span className="text-amber-600 dark:text-amber-400">{t('summary.uncategorized')}</span>
                  ) : null}
                </span>
                {itemAmt !== null && <span className="text-gray-400 dark:text-gray-500">NT${itemAmt}</span>}
              </>
            );
            return canCategorize ? (
              <button
                key={item.id}
                type="button"
                onClick={() => setCatItem({ itemId: item.id, value: cat })}
                className="w-full flex justify-between text-xs text-left"
              >
                {inner}
              </button>
            ) : (
              <div key={item.id} className="flex justify-between text-xs text-gray-400 dark:text-gray-500">
                {inner}
              </div>
            );
          })}
        </div>
      )}
      {catItem && (
        <ItemCategorySheet
          open
          onClose={() => setCatItem(null)}
          value={catItem.value}
          inheritedTag={inheritedTag}
          onSelect={assignCategory}
        />
      )}
    </div>
  );
}

function DateSubGroup({ dateLabel, items, parentMap, subFilter, onEdit }: { dateLabel: string; items: TxRecord[]; parentMap: Map<string, TxRecord>; subFilter?: SubFilter; onEdit?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((s, t) => s + txSignedAmount(t, subFilter ?? null), 0);
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
          {items.map((tx) => <TxEntry key={tx.id} tx={tx} parentMap={parentMap} subFilter={subFilter} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  );
}

function HistoryGroup({ label, items, parentMap, showDateSubs, subFilter, onEdit }: { label: string; items: TxRecord[]; parentMap: Map<string, TxRecord>; showDateSubs?: boolean; subFilter?: SubFilter; onEdit?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((s, t) => s + txSignedAmount(t, subFilter ?? null), 0);

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
            ? dateGroups.map(([d, txs]) => <DateSubGroup key={d} dateLabel={d} items={txs} parentMap={parentMap} subFilter={subFilter} onEdit={onEdit} />)
            : items.map((tx) => <TxEntry key={tx.id} tx={tx} parentMap={parentMap} subFilter={subFilter} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  );
}

function LazyHistoryGroup({ period, onEdit }: { period: PeriodData; onEdit?: (id: string) => void }) {
  const t = useT();
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
            ? <div className="px-4 py-2 text-sm text-gray-400 dark:text-gray-500">{t('common.loading')}</div>
            : dateGroups.map(([d, txs]) => <DateSubGroup key={d} dateLabel={d} items={txs} parentMap={parentMap} onEdit={onEdit} />)}
        </div>
      )}
    </div>
  );
}

export function SummaryScreen() {
  const t = useT();
  const [timeBase, setTimeBase] = useState<TimeBase>('week');
  const [offset, setOffset] = useState(0);
  const [tag, setTag] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<string | null>(null);
  const [subDrilldown, setSubDrilldown] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);

  // Feature 030: a subcategory selection is only meaningful inside a major drilldown, so
  // it resets to null wherever the major drilldown itself resets (FR-007), plus when
  // drilling into a different major.
  const handleDrilldown = (major: string) => {
    setDrilldown(major);
    setSubDrilldown(null);
  };

  const handleTimeBaseChange = (base: TimeBase) => {
    setTimeBase(base);
    setOffset(0);
    setDrilldown(null);
    setSubDrilldown(null);
    // filters preserved per FR-010
  };

  const handleNavigate = (delta: -1 | 1) => {
    setOffset((o) => o + delta);
    setTag(null);
    setPaymentMethod(null);
    setDrilldown(null);
    setSubDrilldown(null);
  };

  const handlePickerSelect = (newOffset: number) => {
    setOffset(newOffset);
    setTag(null);
    setPaymentMethod(null);
    setPickerOpen(false);
    setDrilldown(null);
    setSubDrilldown(null);
  };

  const { data: summaryData, isLoading: summaryLoading } = useSummaryData(timeBase, offset, tag, paymentMethod);
  const { data: subData, isLoading: subLoading } = useSubcategoryData(drilldown, timeBase, offset, tag, paymentMethod);
  const { data: txData } = useTransactions(timeBase, offset, drilldown, tag, paymentMethod);
  const { data: periods } = useTransactionPeriods(timeBase);

  // Filter-bar chips. week/month/year derive them from the period's transactions;
  // the all-time view (which doesn't bulk-load transactions) uses the lightweight /tags endpoint
  // plus the full payment-method list.
  const { data: allPlainTags } = useTags();
  const { data: allTxData } = useTransactions(timeBase, offset);
  const availableTags = useMemo(() => {
    if (timeBase === 'all') return allPlainTags ?? [];
    const txs = allTxData?.transactions ?? [];
    const set = new Set<string>();
    for (const tx of txs) {
      for (const t of tx.tags) { if (!t.includes(':')) set.add(t); }
      for (const item of tx.items) {
        for (const t of item.tags) { if (!t.includes(':')) set.add(t); }
      }
    }
    return Array.from(set).sort();
  }, [timeBase, allPlainTags, allTxData]);

  const availablePaymentMethods = useMemo(() => {
    if (timeBase === 'all') return ALL_PAYMENT_METHODS;
    const txs = allTxData?.transactions ?? [];
    return Array.from(new Set(txs.map((tx) => tx.payment_method))).sort();
  }, [timeBase, allTxData]);

  // Under the all-time view, an active filter/drilldown switches the history from the lazy per-period
  // list to a single filtered, month-grouped list.
  const allFiltered = timeBase === 'all' && (!!tag || !!paymentMethod || !!drilldown);

  const txs = txData?.transactions ?? [];
  // Feature 030: a selected subcategory narrows the already-loaded major list in memory
  // (composition with the active tag/payment/period holds — they're baked into `txs`).
  const subFilter: SubFilter = drilldown && subDrilldown ? { major: drilldown, sub: subDrilldown } : null;
  const filteredTxs = subFilter ? txs.filter((tx) => txInSubcategory(tx, subFilter.major, subFilter.sub)) : txs;
  const groups = groupTransactions(filteredTxs, timeBase);
  // parentMap spans the full major list so a refund's parent still resolves even when the
  // parent itself falls outside the selected subcategory.
  const parentMap = new Map(txs.map((tx) => [tx.id, tx]));
  const subTotal = subFilter ? filteredTxs.reduce((s, tx) => s + subAmount(tx, subFilter.major, subFilter.sub), 0) : 0;

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

      <FilterBar
        tags={availableTags}
        paymentMethods={availablePaymentMethods}
        activeTag={tag}
        activePayment={paymentMethod}
        onTagChange={setTag}
        onPaymentChange={setPaymentMethod}
      />

      {drilldown ? (
        /* ── Drilldown view ── */
        <div>
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-700">
            <button type="button" onClick={() => { setDrilldown(null); setSubDrilldown(null); }} className="text-blue-600 text-sm">
              {t('common.back')}
            </button>
            <span className="font-semibold text-gray-800 dark:text-gray-100">
              {subDrilldown ? `${drilldown} › ${subDrilldown}` : drilldown}
            </span>
            <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
              {subDrilldown ? formatMoney(subTotal) : subData ? formatMoney(subData.total) : null}
            </span>
            {subDrilldown && (
              <button
                type="button"
                onClick={() => setSubDrilldown(null)}
                className="text-sm text-blue-600 whitespace-nowrap"
              >
                ✕ {t('summary.showAll')}
              </button>
            )}
          </div>
          {subLoading ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">{t('common.loading')}</div>
          ) : subData && subData.subcategories.length > 0 ? (
            <div className="px-4 py-3 cursor-pointer">
              <ResponsiveContainer width="100%" height={subData.subcategories.length * 44}>
                <BarChart
                  data={subData.subcategories.map((s) => ({ name: s.subcategory, total: s.total }))}
                  layout="vertical"
                  margin={{ left: 0, right: 16, top: 0, bottom: 0 }}
                  // Click anywhere in a row's band (not just the coloured bar) to select that
                  // subcategory — `activeLabel` is the row under the cursor (FR-001/FR-003);
                  // re-selecting the active one clears it (FR-006a).
                  onClick={(state: { activeLabel?: string }) => {
                    const sub = state?.activeLabel;
                    if (sub) setSubDrilldown((cur) => (cur === sub ? null : sub));
                  }}
                >
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => formatMoney(Number(v))} />
                  <Bar
                    dataKey="total"
                    radius={[0, 4, 4, 0]}
                    minPointSize={6}
                    barSize={24}
                    isAnimationActive={false}
                  >
                    {subData.subcategories.map((s) => {
                      // Shade (venetian-blind style) the non-selected bars when a
                      // subcategory is selected, so the selected one shows through; the CSS
                      // transition animates it down on select and back on clear (FR-008).
                      const shaded = subDrilldown !== null && subDrilldown !== s.subcategory;
                      return (
                        <Cell
                          key={s.subcategory}
                          fill="#3b82f6"
                          fillOpacity={shaded ? 0.25 : 1}
                          style={{ transition: 'fill-opacity 300ms ease' }}
                        />
                      );
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">{t('summary.noSubcategoryData')}</div>
          )}
        </div>
      ) : (
        /* ── Main view ── */
        <div>
          {summaryLoading ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">{t('common.loading')}</div>
          ) : !summaryData || summaryData.categories.length === 0 ? (
            <div className="p-8 text-center text-gray-400 dark:text-gray-500">{t('summary.noExpenses')}</div>
          ) : (
            <>
              <div className="text-center py-2">
                <span className="text-xs text-gray-500 dark:text-gray-400">{t('summary.total')}</span>
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
                    onClick={(entry) => handleDrilldown(entry.name as string)}
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
                    onClick={() => handleDrilldown(c.category)}
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
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{t('summary.txHistory')}</span>
        </div>
        {timeBase === 'all' && !allFiltered ? (
          periods === undefined
            ? <div className="p-4 text-center text-gray-400 dark:text-gray-500 text-sm">{t('common.loading')}</div>
            : periods.length === 0
              ? <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-4">{t('summary.noTransactions')}</p>
              : periods.map((p) => <LazyHistoryGroup key={p.period} period={p} onEdit={setEditingTxId} />)
        ) : groups.length === 0 ? (
          <p className="text-center text-gray-400 dark:text-gray-500 text-sm py-4">{t('summary.noTransactions')}</p>
        ) : (
          groups.map((g) => (
            <HistoryGroup
              key={g.label}
              label={g.label}
              items={g.items}
              parentMap={parentMap}
              showDateSubs={timeBase === 'year' || timeBase === 'all'}
              subFilter={subFilter}
              onEdit={setEditingTxId}
            />
          ))
        )}
      </div>
    </div>
  );
}
