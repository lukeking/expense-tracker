import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, queryClient } from '../api/client';
import { CategoryPicker } from '../components/CategoryPicker';
import type { CategorySelection } from '../components/CategoryPicker';
import { TagInput } from '../components/TagInput';
import { ItemRow } from '../components/ItemRow';
import type { ItemRowData } from '../components/ItemRow';
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
  return { id: crypto.randomUUID(), tagOverride: null, name: '', amount: null };
}

// ─── Expense form ─────────────────────────────────────────────────────────────

function ExpenseForm() {
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  const [category, setCategory] = useState<CategorySelection | null>(null);
  const [freeTags, setFreeTags] = useState<string[]>([]);
  const [items, setItems] = useState<ItemRowData[]>([]);
  const [note, setNote] = useState('');
  const [toast, setToast] = useState('');

  const categoryTag = deriveCategoryTag(category);
  const nonNullAmounts = items.filter((i) => i.amount !== null).map((i) => i.amount as number);
  const itemSum = nonNullAmounts.reduce((s, a) => s + a, 0);
  const amountVal = parseInt(amount, 10) || 0;
  const allItemsHaveAmount = items.length > 0 && items.every((i) => i.amount !== null);
  const sumExceedsTotal = allItemsHaveAmount && itemSum > amountVal;

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
          items: items.map((i) => ({ name: i.name, amount: i.amount, tag: i.tagOverride })),
        }),
      }),
    onSuccess: () => {
      setAmount(''); setCategory(null); setFreeTags([]); setItems([]); setNote('');
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

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (!sumExceedsTotal && amountVal > 0) mutation.mutate(); }}
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
        <input
          type="number"
          min="1"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="text-3xl font-bold w-full border-b-2 border-gray-300 dark:border-gray-600 outline-none pb-1 focus:border-blue-500 bg-transparent text-gray-900 dark:text-white"
          required
        />
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

      {/* Items */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">品項明細</label>
          {items.length > 0 && (
            <span className={`text-xs font-medium ${sumExceedsTotal ? 'text-red-600' : itemSum === amountVal && allItemsHaveAmount ? 'text-green-600' : 'text-gray-500 dark:text-gray-400'}`}>
              {sumExceedsTotal ? `超出 NT$${itemSum - amountVal}` : `NT$${itemSum} / NT$${amountVal}`}
            </span>
          )}
        </div>
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            inheritedTag={categoryTag}
            extraTags={freeTags}
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

      {/* Error */}
      {mutation.error && (
        <p className="text-red-600 text-sm">{(mutation.error as Error).message}</p>
      )}
      {sumExceedsTotal && (
        <p className="text-red-600 text-sm">品項金額合計超過總金額，請修正後再送出</p>
      )}

      <button
        type="submit"
        disabled={mutation.isPending || sumExceedsTotal || amountVal <= 0}
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
