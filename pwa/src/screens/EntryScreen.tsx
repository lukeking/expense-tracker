import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, queryClient } from '../api/client';
import { CategoryPicker } from '../components/CategoryPicker';
import type { CategorySelection } from '../components/CategoryPicker';
import { TagInput } from '../components/TagInput';
import { ItemRow } from '../components/ItemRow';
import type { ItemRowData } from '../components/ItemRow';
import { AdjustmentRow, KIND_LABELS, resolveAdjAmount } from '../components/AdjustmentRow';
import type { AdjustmentRowData } from '../components/AdjustmentRow';
import { PaymentPills } from '../components/PaymentPills';
import type { PaymentMethod } from '../components/PaymentPills';
import { ParentSearch } from '../components/ParentSearch';
import type { ParentSearchResult } from '../components/ParentSearch';

type Tab = 'expense' | 'fee' | 'refund';

const TAB_LABELS: Record<Tab, string> = { expense: '支出', fee: '手續費', refund: '退款' };
const TABS: Tab[] = ['expense', 'fee', 'refund'];

function deriveCategoryTag(sel: CategorySelection | null): string | null {
  if (!sel) return null;
  return sel.subcategory ? `${sel.major}:${sel.subcategory}` : sel.major;
}

function newItem(): ItemRowData {
  return { id: crypto.randomUUID(), tagOverride: null, name: '', amount: null, note: '', approxFlag: false };
}

function newAdjustment(): AdjustmentRowData {
  return { id: crypto.randomUUID(), kind: 'discount', mode: 'absolute', value: null, note: '' };
}

// ─── Expense form ─────────────────────────────────────────────────────────────

function ExpenseForm() {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  const [category, setCategory] = useState<CategorySelection | null>(null);
  const [freeTags, setFreeTags] = useState<string[]>([]);
  const [items, setItems] = useState<ItemRowData[]>([newItem()]);
  const [adjustments, setAdjustments] = useState<AdjustmentRowData[]>([]);
  const [showAdj, setShowAdj] = useState(false);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');

  const categoryTag = deriveCategoryTag(category);
  const nonNullAmounts = items.filter((i) => i.amount !== null).map((i) => i.amount as number);
  const itemSum = nonNullAmounts.reduce((s, a) => s + a, 0);
  const amountVal = parseInt(amount, 10) || 0;
  const allItemsHaveAmount = items.length > 0 && items.every((i) => i.amount !== null);

  // % rows compute against items subtotal; fall back to entered amount when no items
  const percentBase = itemSum > 0 ? itemSum : amountVal;

  // Reconciliation: SUM(items) - discount - refund + fee = computed paid
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

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/pwa/expense', {
        method: 'POST',
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
      setAmount(''); setCategory(null); setFreeTags([]); setItems([newItem()]); setAdjustments([]); setNote(''); setShowAdj(false);
      setToast('記錄成功！');
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      setTimeout(() => setToast(''), 2000);
    },
  });

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

  const canSubmit = amountVal > 0 && items.length > 0;

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}
      className="flex flex-col gap-4 p-4 overflow-y-auto h-full"
    >
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-full text-sm z-50">
          {toast}
        </div>
      )}

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

      {/* Adjustments — inline, between amount and items */}
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
            <span className="text-xs text-gray-500 dark:text-gray-400">
              NT${itemSum}
            </span>
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
            onRemove={items.length > 1 ? () => setItems((prev) => prev.filter((i) => i.id !== item.id)) : undefined}
          />
        ))}
        {items.length === 0 && (
          <p className="text-xs text-orange-500 mt-1">請至少新增一個品項</p>
        )}
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, newItem()])}
          className="mt-2 text-sm text-blue-600 flex items-center gap-1"
        >
          ＋ 新增品項
        </button>
      </div>

      {/* Reconciliation row — visible when all items have amounts */}
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

      {/* Errors */}
      {mutation.error && (
        <p className="text-red-600 text-sm">{(mutation.error as Error).message}</p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending || !canSubmit}
        className="mt-auto bg-blue-600 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
      >
        {mutation.isPending ? '送出中…' : '送出'}
      </button>
    </form>
  );
}

// ─── Fee form ─────────────────────────────────────────────────────────────────

function FeeForm() {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [parent, setParent] = useState<ParentSearchResult | null>(null);
  const [toast, setToast] = useState('');

  const amountVal = parseInt(amount, 10) || 0;

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/pwa/fee', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountVal,
          description: description.trim() || '國外交易服務費',
          parent_transaction_id: parent?.id ?? null,
        }),
      }),
    onSuccess: () => {
      setAmount(''); setDescription(''); setParent(null);
      setToast('手續費已記錄');
      setTimeout(() => setToast(''), 2000);
    },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (amountVal > 0) mutation.mutate(); }}
      className="flex flex-col gap-4 p-4 overflow-y-auto h-full"
    >
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-full text-sm z-50">
          {toast}
        </div>
      )}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">金額 (NTD)</label>
        <input
          type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="0" required
          className="text-3xl font-bold w-full border-b-2 border-gray-300 dark:border-gray-600 outline-none pb-1 focus:border-blue-500 bg-transparent text-gray-900 dark:text-white"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">說明</label>
        <input
          type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="國外交易服務費"
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">連結原始交易（可選）</label>
        <ParentSearch
          value={parent}
          onSelect={(result) => {
            setParent(result);
            if (result && !description.trim()) {
              const label = result.note ?? result.item_names[0] ?? result.tags[0] ?? '';
              if (label) setDescription(label);
            }
          }}
        />
      </div>
      {mutation.error && <p className="text-red-600 text-sm">{(mutation.error as Error).message}</p>}
      <button
        type="submit"
        disabled={mutation.isPending || amountVal <= 0}
        className="mt-auto bg-blue-600 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
      >
        {mutation.isPending ? '送出中…' : '送出'}
      </button>
    </form>
  );
}

// ─── Refund form ──────────────────────────────────────────────────────────────

function RefundForm() {
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  const [parent, setParent] = useState<ParentSearchResult | null>(null);
  const [toast, setToast] = useState('');

  const amountVal = parseInt(amount, 10) || 0;

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/pwa/refund', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountVal,
          description: description.trim(),
          payment_method: paymentMethod,
          parent_transaction_id: parent?.id ?? null,
        }),
      }),
    onSuccess: () => {
      setAmount(''); setDescription(''); setParent(null);
      setToast('退款已記錄');
      setTimeout(() => setToast(''), 2000);
    },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (amountVal > 0 && description.trim()) mutation.mutate(); }}
      className="flex flex-col gap-4 p-4 overflow-y-auto h-full"
    >
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-full text-sm z-50">
          {toast}
        </div>
      )}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">金額 (NTD)</label>
        <input
          type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="0" required
          className="text-3xl font-bold w-full border-b-2 border-gray-300 dark:border-gray-600 outline-none pb-1 focus:border-blue-500 bg-transparent text-gray-900 dark:text-white"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">說明</label>
        <input
          type="text" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="如：訂單退款" required
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">退款至</label>
        <PaymentPills value={paymentMethod} onChange={setPaymentMethod} />
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">連結原始交易（可選）</label>
        <ParentSearch value={parent} onSelect={setParent} />
      </div>
      {mutation.error && <p className="text-red-600 text-sm">{(mutation.error as Error).message}</p>}
      <button
        type="submit"
        disabled={mutation.isPending || amountVal <= 0 || !description.trim()}
        className="mt-auto bg-blue-600 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
      >
        {mutation.isPending ? '送出中…' : '送出'}
      </button>
    </form>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function EntryScreen() {
  const [tab, setTab] = useState<Tab>('expense');

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === t ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-hidden">
        {tab === 'expense' && <ExpenseForm />}
        {tab === 'fee' && <FeeForm />}
        {tab === 'refund' && <RefundForm />}
      </div>
    </div>
  );
}
