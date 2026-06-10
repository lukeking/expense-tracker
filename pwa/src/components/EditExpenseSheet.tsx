import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch, queryClient } from '../api/client';
import { CategoryPicker } from './CategoryPicker';
import type { CategorySelection } from './CategoryPicker';
import { TagInput } from './TagInput';
import { ItemRow } from './ItemRow';
import type { ItemRowData } from './ItemRow';
import { AdjustmentRow, KIND_LABELS, resolveAdjAmount } from './AdjustmentRow';
import type { AdjustmentRowData, AdjustmentKind } from './AdjustmentRow';
import { PaymentPills } from './PaymentPills';
import type { PaymentMethod } from './PaymentPills';
import { EditHistorySection } from './EditHistorySection';

type EditDiff = {
  header?: Record<string, { before: unknown; after: unknown }>;
  items?: { before: { name: string; amount: number | null; tags: string[]; note: string | null }[]; after: { name: string; amount: number | null; tags: string[]; note: string | null }[] };
  adjustments?: { before: { kind: string; amount: number; note: string | null }[]; after: { kind: string; amount: number; note: string | null }[] };
};

type TxDetail = {
  id: string;
  amount: number;
  payment_method: string;
  tags: string[];
  note: string | null;
  transaction_at: string;
  transaction_type: string;
  items: { id: string; name: string; amount: number | null; tags: string[]; note: string | null; sort_order: number }[];
  adjustments: { id: string; kind: string; amount: number; note: string | null; basis: string | null; basis_value: number | null }[];
  history: { id: string; edited_at: string; diff: EditDiff }[];
};

function deriveCategoryTag(items: TxDetail['items']): string | null {
  for (const item of items) {
    const cat = item.tags.find((t) => t.includes(':'));
    if (cat) return cat;
  }
  return null;
}

function parseCategorySelection(tag: string | null): CategorySelection | null {
  if (!tag) return null;
  const idx = tag.indexOf(':');
  if (idx === -1) return { major: tag, subcategory: null };
  return { major: tag.slice(0, idx), subcategory: tag.slice(idx + 1) };
}

function deriveCategoryTag2(sel: CategorySelection | null): string | null {
  if (!sel) return null;
  return sel.subcategory ? `${sel.major}:${sel.subcategory}` : sel.major;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function preloadItems(rawItems: TxDetail['items'], categoryTag: string | null): ItemRowData[] {
  return rawItems.map((item) => {
    const itemCatTag = item.tags.find((t) => t.includes(':')) ?? null;
    return {
      id: crypto.randomUUID(),
      tagOverride: itemCatTag !== categoryTag ? itemCatTag : null,
      name: item.name,
      amount: item.amount,
      note: item.note ?? '',
      approxFlag: false,
    };
  });
}

function preloadAdjustments(rawAdjs: TxDetail['adjustments']): AdjustmentRowData[] {
  return rawAdjs.map((a) => ({
    id: crypto.randomUUID(),
    kind: a.kind as AdjustmentKind,
    mode: a.basis === 'percentage' ? 'percentage' : 'absolute',
    value: a.basis === 'percentage' ? a.basis_value : a.amount,
    note: a.note ?? '',
  }));
}

function newItem(): ItemRowData {
  return { id: crypto.randomUUID(), tagOverride: null, name: '', amount: null, note: '', approxFlag: false };
}

function newAdjustment(): AdjustmentRowData {
  return { id: crypto.randomUUID(), kind: 'discount', mode: 'absolute', value: null, note: '' };
}

// ─── Edit form (inner) ────────────────────────────────────────────────────────

function EditExpenseFormInner({ tx, onClose }: { tx: TxDetail; onClose: () => void }) {
  // B1: category may live on the items (itemized tx) or on the transaction itself
  // (itemless tx / legacy data). Prefer item-level, fall back to the tx-level :-tag.
  const categoryTag0 = deriveCategoryTag(tx.items) ?? tx.tags.find((t) => t.includes(':')) ?? null;

  const [amount, setAmount] = useState(String(tx.amount));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(tx.payment_method as PaymentMethod);
  const [category, setCategory] = useState<CategorySelection | null>(parseCategorySelection(categoryTag0));
  const [freeTags, setFreeTags] = useState<string[]>(tx.tags.filter((t) => !t.includes(':')));
  const [note, setNote] = useState(tx.note ?? '');
  const [items, setItems] = useState<ItemRowData[]>(() => preloadItems(tx.items, categoryTag0));
  const [adjustments, setAdjustments] = useState<AdjustmentRowData[]>(() => preloadAdjustments(tx.adjustments));
  const [showAdj, setShowAdj] = useState(tx.adjustments.length > 0);

  useEffect(() => {
    // Re-initialise if tx prop changes (e.g. query refetch — unlikely but safe)
  }, [tx.id]);

  const categoryTag = deriveCategoryTag2(category);
  const amountVal = parseInt(amount, 10) || 0;
  const nonNullAmounts = items.filter((i) => i.amount !== null).map((i) => i.amount as number);
  const itemSum = nonNullAmounts.reduce((s, a) => s + a, 0);
  const allItemsHaveAmount = items.length > 0 && items.every((i) => i.amount !== null);
  const percentBase = itemSum > 0 ? itemSum : amountVal;

  const feeTotal = adjustments.reduce((s, a) => {
    if (a.kind !== 'fee') return s;
    const amt = resolveAdjAmount(a, percentBase);
    return amt != null ? s + amt : s;
  }, 0);
  const deductTotal = adjustments.reduce((s, a) => {
    if (a.kind === 'fee') return s;
    const amt = resolveAdjAmount(a, percentBase);
    return amt != null ? s + amt : s;
  }, 0);
  const computedPaid = itemSum + feeTotal - deductTotal;
  const paidDiff = computedPaid - amountVal;

  function updateItem(id: string, updated: ItemRowData) {
    setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
  }

  function updateAdjustment(id: string, updated: AdjustmentRowData) {
    setAdjustments((prev) => prev.map((a) => (a.id === id ? updated : a)));
  }

  function makeOnMax(itemId: string): (() => void) | null {
    if (!amountVal) return null;
    return () => {
      const otherSum = items
        .filter((i) => i.id !== itemId && i.amount !== null)
        .reduce((s, i) => s + (i.amount as number), 0);

      const absGross = adjustments.reduce((s, a) => {
        if (a.mode !== 'absolute' || a.value == null) return s;
        return a.kind === 'fee' ? s - a.value : s + a.value;
      }, 0);

      const pctGross = adjustments.reduce((s, a) => {
        if (a.mode !== 'percentage' || a.value == null) return s;
        return a.kind === 'fee' ? s - a.value : s + a.value;
      }, 0);

      const divisor = 1 - pctGross / 100;
      if (divisor <= 0) return;
      const rawGross = (amountVal + absGross) / divisor;
      const grossTotal = Math.round(rawGross);
      const maxVal = grossTotal - otherSum;
      if (maxVal <= 0) return;

      const approxFlag = Math.abs(rawGross - grossTotal) > 0.001;
      setItems((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, amount: maxVal, approxFlag } : i))
      );
    };
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/pwa/transactions/${tx.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          amount: amountVal,
          payment_method: paymentMethod,
          category_tag: categoryTag,
          free_tags: freeTags,
          note: note.trim() || null,
          items: items.map((i) => ({ name: i.name, amount: i.amount, tag: i.tagOverride, note: i.note.trim() || null })),
          adjustments: adjustments
            .map((a) => ({ a, amt: resolveAdjAmount(a, percentBase) }))
            .filter(({ amt }) => amt != null && amt > 0)
            .map(({ a, amt }) => ({
              kind: a.kind,
              amount: amt,
              note: a.note.trim() || null,
              basis: a.mode === 'percentage' ? 'percentage' : null,
              basis_value: a.mode === 'percentage' ? a.value : null,
            })),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['tx-detail', tx.id] });
      queryClient.invalidateQueries({ queryKey: ['tx-month'] });
      onClose();
    },
  });

  const canSubmit = amountVal > 0;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}
      className="flex flex-col gap-4 p-4 overflow-y-auto h-full"
    >
      {/* Consumption time (read-only for now) */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">消費時間</label>
        <p className="text-sm text-gray-600 dark:text-gray-300">{formatDateTime(tx.transaction_at)}</p>
      </div>

      {/* Amount */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">金額 (NTD)</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="text-3xl font-bold flex-1 min-w-0 border-b-2 border-gray-300 dark:border-gray-600 outline-none pb-1 focus:border-blue-500 bg-transparent text-gray-900 dark:text-white"
            required
          />
          <button
            type="button"
            onClick={() => setShowAdj((v) => !v)}
            className="flex-shrink-0 text-gray-400 dark:text-gray-500 px-1 pb-1 text-sm"
            aria-label="折抵設定"
          >
            {showAdj ? '▾' : '▸'}
          </button>
        </div>
      </div>

      {/* Payment method */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">付款方式</label>
        <PaymentPills value={paymentMethod} onChange={setPaymentMethod} />
      </div>

      {/* Category */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">分類</label>
        <CategoryPicker value={category} onChange={setCategory} />
      </div>

      {/* Free tags */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">標籤</label>
        <TagInput value={freeTags} onChange={setFreeTags} />
      </div>

      {/* Adjustments */}
      {showAdj && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 pb-3 pt-2">
          {adjustments.map((adj) => (
            <AdjustmentRow
              key={adj.id}
              adj={adj}
              base={percentBase}
              onChange={(updated) => updateAdjustment(adj.id, updated)}
              onRemove={() => setAdjustments((prev) => prev.filter((a) => a.id !== adj.id))}
            />
          ))}
          <button
            type="button"
            onClick={() => setAdjustments((prev) => [...prev, newAdjustment()])}
            className="mt-2 text-sm text-blue-600 flex items-center gap-1"
          >
            ＋ 新增折抵
          </button>
        </div>
      )}

      {/* Items */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">品項明細</label>
          {items.length > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400">NT${itemSum}</span>
          )}
        </div>
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            inheritedTag={categoryTag}
            extraTags={freeTags}
            onMax={makeOnMax(item.id)}
            onChange={(updated) => updateItem(item.id, updated)}
            onRemove={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
          />
        ))}
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, newItem()])}
          className="mt-2 text-sm text-blue-600 flex items-center gap-1"
        >
          ＋ 新增品項
        </button>
      </div>

      {/* Reconciliation row */}
      {allItemsHaveAmount && items.length > 0 && (
        <div className="text-xs rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 space-y-0.5">
          <div className="flex justify-between text-gray-500 dark:text-gray-400">
            <span>品項合計</span>
            <span>NT${itemSum}</span>
          </div>
          {adjustments.map((a) => {
            const amt = resolveAdjAmount(a, percentBase);
            if (amt == null) return null;
            const isDeduct = a.kind !== 'fee';
            return (
              <div key={a.id} className="flex justify-between text-gray-500 dark:text-gray-400">
                <span>{KIND_LABELS[a.kind]}</span>
                <span>{isDeduct ? '−' : '+'}NT${amt}</span>
              </div>
            );
          })}
          <div className={`flex justify-between font-semibold border-t border-gray-200 dark:border-gray-700 pt-1 ${paidDiff === 0 ? 'text-green-600 dark:text-green-400' : 'text-orange-500'}`}>
            <span>計算實付</span>
            <span>
              NT${computedPaid}
              {paidDiff !== 0 && ` ⚠ 差 NT$${Math.abs(paidDiff)}`}
              {paidDiff === 0 && ' ✓'}
            </span>
          </div>
        </div>
      )}

      {/* Note */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">備註</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="可不填"
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
      </div>

      {/* Edit history */}
      <EditHistorySection history={tx.history} />

      {/* Save error */}
      {mutation.error && (
        <p className="text-red-600 text-sm">{(mutation.error as Error).message}</p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending || !canSubmit}
        className="mt-auto bg-blue-600 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
      >
        {mutation.isPending ? '儲存中…' : '儲存'}
      </button>
    </form>
  );
}

// ─── EditExpenseSheet (overlay wrapper) ──────────────────────────────────────

export function EditExpenseSheet({ txId, onClose }: { txId: string; onClose: () => void }) {
  const { data: tx, isLoading, error } = useQuery({
    queryKey: ['tx-detail', txId],
    queryFn: () => apiFetch<TxDetail>(`/pwa/transactions/${txId}`),
    staleTime: 0,
  });

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900 flex flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="text-blue-600 text-sm"
        >
          ← 返回
        </button>
        <span className="font-semibold text-gray-800 dark:text-gray-100 flex-1">編輯支出</span>
      </div>
      <div className="flex-1 overflow-hidden">
        {isLoading && (
          <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
            載入中…
          </div>
        )}
        {error && (
          <div className="h-full flex items-center justify-center text-red-500 text-sm px-4">
            載入失敗：{(error as Error).message}
          </div>
        )}
        {tx && <EditExpenseFormInner tx={tx} onClose={onClose} />}
      </div>
    </div>
  );
}
