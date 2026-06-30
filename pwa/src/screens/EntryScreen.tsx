import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiFetch, queryClient } from '../api/client';
import { CategoryPicker } from '../components/CategoryPicker';
import type { CategorySelection } from '../components/CategoryPicker';
import { TagInput } from '../components/TagInput';
import { ItemRow } from '../components/ItemRow';
import type { ItemRowData } from '../components/ItemRow';
import { AdjustmentRow, KIND_LABEL_KEYS, resolveAdjAmount } from '../components/AdjustmentRow';
import type { AdjustmentRowData } from '../components/AdjustmentRow';
import { PaymentPills } from '../components/PaymentPills';
import type { PaymentMethod } from '../components/PaymentPills';
import { DescriptionSuggest } from '../components/DescriptionSuggest';
import { ParentSearch } from '../components/ParentSearch';
import type { ParentSearchResult } from '../components/ParentSearch';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';
import { parseCategorySelection } from '../lib/categoryTag';

type Tab = 'expense' | 'fee' | 'refund';

const TAB_LABEL_KEYS: Record<Tab, MessageKey> = {
  expense: 'entry.tabExpense',
  fee: 'entry.tabFee',
  refund: 'entry.tabRefund',
};
const TABS: Tab[] = ['expense', 'fee', 'refund'];

function deriveCategoryTag(sel: CategorySelection | null): string | null {
  // A category is only complete as `主:子`. A major-only selection must NOT emit a
  // bare, colon-less tag — that categorizes nothing and leaks into plain tags on
  // re-read. Treat it as "no category"; the form blocks submit until a sub is picked.
  if (!sel || !sel.subcategory) return null;
  return `${sel.major}:${sel.subcategory}`;
}

function newItem(): ItemRowData {
  return { id: crypto.randomUUID(), tagOverride: null, name: '', amount: null, note: '', approxFlag: false };
}

function newAdjustment(): AdjustmentRowData {
  return { id: crypto.randomUUID(), kind: 'discount', mode: 'absolute', value: null, note: '' };
}

// ─── Expense form ─────────────────────────────────────────────────────────────

function ExpenseForm() {
  const t = useT();
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
  const categoryIncomplete = category !== null && category.subcategory === null;
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
      setToast(t('entry.toastExpenseSaved'));
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

  const canSubmit = amountVal > 0 && items.length > 0 && !categoryIncomplete;
  const missing = [
    amountVal > 0 ? null : t('entry.fieldAmount'),
    items.length > 0 ? null : t('entry.fieldItem'),
  ].filter(Boolean);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}
      className="flex flex-col h-full"
    >
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-full text-sm z-50">
          {toast}
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">
      {/* Amount */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />
          {t('entry.amountLabel')}
        </label>
        <input
          type="number"
          min="1"
          inputMode="numeric"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="text-3xl font-bold w-full border-b-2 border-gray-300 dark:border-gray-600 outline-none pb-1 focus:border-blue-500 bg-transparent text-gray-900 dark:text-white"
          required
        />
        <button
          type="button"
          onClick={() => setShowAdj((v) => !v)}
          className="mt-1.5 text-sm text-blue-600 dark:text-blue-400"
          aria-label={t('entry.adjAria')}
        >
          {t('entry.adjToggle')} {showAdj ? '⌄' : '›'}
        </button>
      </div>

      {/* Payment method */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />{t('entry.paymentMethod')}</label>
        <PaymentPills value={paymentMethod} onChange={setPaymentMethod} />
      </div>

      {/* Category */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500" />{t('entry.category')}</label>
        <CategoryPicker value={category} onChange={setCategory} />
        {categoryIncomplete && (
          <p className="text-xs text-orange-500 mt-1">{t('category.subRequired')}</p>
        )}
      </div>

      {/* Free tags */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500" />{t('entry.tags')}</label>
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
            {t('entry.addAdjustment')}
          </button>
        </div>
      )}

      {/* Items */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />{t('entry.itemDetails')}</label>
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
          <p className="text-xs text-orange-500 mt-1">{t('entry.itemRequired')}</p>
        )}
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, newItem()])}
          className="mt-2 text-sm text-blue-600 flex items-center gap-1"
        >
          {t('entry.addItem')}
        </button>
      </div>

      {/* Reconciliation row — visible when all items have amounts */}
      {allItemsHaveAmount && items.length > 0 && (
        <div className="text-xs rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 space-y-0.5">
          <div className="flex justify-between text-gray-500 dark:text-gray-400">
            <span>{t('entry.itemSubtotal')}</span>
            <span>NT${itemSum}</span>
          </div>
          {adjustments.map((a) => {
            const amt = resolveAdjAmount(a, percentBase);
            if (amt == null) return null;
            const isDeduct = a.kind !== 'fee';
            return (
              <div key={a.id} className="flex justify-between text-gray-500 dark:text-gray-400">
                <span>{t(KIND_LABEL_KEYS[a.kind])}</span>
                <span>{isDeduct ? '−' : '+'}NT${amt}</span>
              </div>
            );
          })}
          <div className={`flex justify-between font-semibold border-t border-gray-200 dark:border-gray-700 pt-1 ${paidDiff === 0 ? 'text-green-600 dark:text-green-400' : 'text-orange-500'}`}>
            <span>{t('entry.computedPaid')}</span>
            <span>
              NT${computedPaid}
              {paidDiff !== 0 && t('entry.paidDiff', { n: Math.abs(paidDiff) })}
              {paidDiff === 0 && ' ✓'}
            </span>
          </div>
        </div>
      )}

      {/* Note */}
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('entry.note')}</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('entry.notePlaceholder')}
          className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
        />
      </div>

      </div>

      {/* Pinned submit footer */}
      <div className="p-4 pt-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {mutation.error && (
          <p className="text-red-600 text-sm mb-2">{(mutation.error as Error).message}</p>
        )}
        <button
          type="submit"
          disabled={mutation.isPending}
          aria-disabled={!canSubmit}
          className={`w-full rounded-xl py-3 font-semibold transition-colors disabled:opacity-60 ${
            canSubmit
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          }`}
        >
          {mutation.isPending
            ? t('entry.submitting')
            : canSubmit
              ? `${t('entry.submit')} · NT$${amountVal.toLocaleString()}`
              : t('entry.missingFields', { fields: missing.join('・') })}
        </button>
      </div>
    </form>
  );
}

// ─── Fee form ─────────────────────────────────────────────────────────────────

function FeeForm() {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  const [category, setCategory] = useState<CategorySelection | null>(null);
  const [description, setDescription] = useState('');
  const [parent, setParent] = useState<ParentSearchResult | null>(null);
  const [toast, setToast] = useState('');
  // Track manual edits so linking a parent never overwrites a field the user has set.
  const [paymentTouched, setPaymentTouched] = useState(false);
  const [categoryTouched, setCategoryTouched] = useState(false);

  const amountVal = parseInt(amount, 10) || 0;
  const categoryTag = deriveCategoryTag(category);
  const categoryIncomplete = category !== null && category.subcategory === null;
  const canSubmit = amountVal > 0 && !categoryIncomplete;
  const missing = amountVal > 0 ? [] : [t('entry.fieldAmount')];

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch('/pwa/fee', {
        method: 'POST',
        body: JSON.stringify({
          amount: amountVal,
          payment_method: paymentMethod,
          category_tag: categoryTag,
          description: description.trim() || t('entry.feeDescPlaceholder'),
          parent_transaction_id: parent?.id ?? null,
        }),
      }),
    onSuccess: () => {
      setAmount(''); setPaymentMethod('credit_card'); setCategory(null); setDescription(''); setParent(null);
      setPaymentTouched(false); setCategoryTouched(false);
      setToast(t('entry.toastFeeSaved'));
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      setTimeout(() => setToast(''), 2000);
    },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}
      className="flex flex-col h-full"
    >
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-full text-sm z-50">
          {toast}
        </div>
      )}
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />{t('entry.amountLabel')} <span className="text-gray-400 dark:text-gray-500">· {t('entry.feeAmountHint')}</span></label>
        <input
          type="number" min="1" inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="0" required
          className="text-3xl font-bold w-full border-b-2 border-gray-300 dark:border-gray-600 outline-none pb-1 focus:border-blue-500 bg-transparent text-gray-900 dark:text-white"
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500" />{t('entry.linkOriginal')} <span className="text-gray-400 dark:text-gray-500">{t('entry.linkOriginalHintFee')}</span></label>
        <ParentSearch
          value={parent}
          onSelect={(result) => {
            setParent(result);
            if (result) {
              if (!paymentTouched) setPaymentMethod(result.payment_method as PaymentMethod);
              if (!categoryTouched && result.category) setCategory(parseCategorySelection(result.category));
              if (!description.trim()) {
                const label = result.note ?? result.item_names[0] ?? result.tags[0] ?? '';
                if (label) setDescription(label);
              }
            }
          }}
        />
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />{t('entry.paymentMethod')}{parent && <span className="text-gray-400 dark:text-gray-500">{t('entry.autofilled')}</span>}</label>
        <PaymentPills value={paymentMethod} onChange={(v) => { setPaymentTouched(true); setPaymentMethod(v); }} />
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-500" />{t('entry.category')}{parent && category && <span className="text-gray-400 dark:text-gray-500">{t('entry.autofilled')}</span>}</label>
        <CategoryPicker value={category} onChange={(v) => { setCategoryTouched(true); setCategory(v); }} />
        {categoryIncomplete && (
          <p className="text-xs text-orange-500 mt-1">{t('category.subRequired')}</p>
        )}
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />{t('entry.description')}</label>
        <DescriptionSuggest value={description} onChange={setDescription} type="fee" placeholder={t('entry.feeDescPlaceholder')} />
      </div>
      </div>

      {/* Pinned submit footer */}
      <div className="p-4 pt-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {mutation.error && <p className="text-red-600 text-sm mb-2">{(mutation.error as Error).message}</p>}
        {canSubmit && (
          <div className="flex items-center gap-1.5 mb-2 text-xs text-green-600 dark:text-green-400"><span>✓</span><span>{t('entry.readyToSubmit')}</span></div>
        )}
        <button
          type="submit"
          disabled={mutation.isPending}
          aria-disabled={!canSubmit}
          className={`w-full rounded-xl py-3 font-semibold transition-colors disabled:opacity-60 ${
            canSubmit
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          }`}
        >
          {mutation.isPending
            ? t('entry.submitting')
            : canSubmit
              ? `${t('entry.submit')} · NT$${amountVal.toLocaleString()}`
              : t('entry.missingFields', { fields: missing.join('・') })}
        </button>
      </div>
    </form>
  );
}

// ─── Refund form ──────────────────────────────────────────────────────────────

function RefundForm() {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  const [parent, setParent] = useState<ParentSearchResult | null>(null);
  const [toast, setToast] = useState('');
  // Track a manual payment pick so linking a parent never overwrites it.
  const [paymentTouched, setPaymentTouched] = useState(false);

  const amountVal = parseInt(amount, 10) || 0;
  const canSubmit = amountVal > 0 && !!description.trim();
  const missing = [
    amountVal > 0 ? null : t('entry.fieldAmount'),
    description.trim() ? null : t('entry.fieldDescription'),
  ].filter(Boolean);

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
      setPaymentTouched(false);
      setToast(t('entry.toastRefundSaved'));
      setTimeout(() => setToast(''), 2000);
    },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}
      className="flex flex-col h-full"
    >
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-full text-sm z-50">
          {toast}
        </div>
      )}
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500" />{t('entry.amountLabel')} <span className="text-xs text-green-600 dark:text-green-400">{t('entry.refundDirection')}</span></label>
        <div className="flex items-end gap-2">
          <span className="text-xl font-bold text-green-600 dark:text-green-400 pb-1">+ NT$</span>
          <input
            type="number" min="1" inputMode="numeric" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0" required
            className="text-3xl font-bold flex-1 min-w-0 border-b-2 border-gray-300 dark:border-gray-600 outline-none pb-1 focus:border-blue-500 bg-transparent text-green-600 dark:text-green-400"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500" />{t('entry.linkOriginal')} <span className="text-gray-400 dark:text-gray-500">{t('entry.linkOriginalHintRefund')}</span></label>
        <ParentSearch
          value={parent}
          onSelect={(result) => {
            setParent(result);
            if (result) {
              if (!paymentTouched) setPaymentMethod(result.payment_method as PaymentMethod);
              if (!description.trim()) {
                const label = result.note ?? result.item_names[0] ?? result.tags[0] ?? '';
                if (label) setDescription(label);
              }
            }
          }}
        />
        {parent && (
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => setAmount(String(parent.amount))}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${amountVal === parent.amount ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}
            >
              {t('entry.refundFull')}
            </button>
            <button
              type="button"
              onClick={() => { if (amountVal === parent.amount) setAmount(''); }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${amountVal !== parent.amount ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'}`}
            >
              {t('entry.refundPartial')}
            </button>
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-auto">{t('entry.refundOriginal', { amt: parent.amount.toLocaleString() })}</span>
          </div>
        )}
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" />{t('entry.refundTo')}{parent && <span className="text-gray-400 dark:text-gray-500">{t('entry.autofilled')}</span>}</label>
        <PaymentPills value={paymentMethod} onChange={(v) => { setPaymentTouched(true); setPaymentMethod(v); }} />
      </div>
      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 flex items-center gap-1.5"><span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />{t('entry.description')}</label>
        <DescriptionSuggest value={description} onChange={setDescription} type="refund" placeholder={t('entry.refundDescPlaceholder')} required />
      </div>
      </div>

      {/* Pinned submit footer */}
      <div className="p-4 pt-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {mutation.error && <p className="text-red-600 text-sm mb-2">{(mutation.error as Error).message}</p>}
        {canSubmit && (
          <div className="flex items-center gap-1.5 mb-2 text-xs text-green-600 dark:text-green-400"><span>✓</span><span>{t('entry.readyToSubmit')}</span></div>
        )}
        <button
          type="submit"
          disabled={mutation.isPending}
          aria-disabled={!canSubmit}
          className={`w-full rounded-xl py-3 font-semibold transition-colors disabled:opacity-60 ${
            canSubmit
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
          }`}
        >
          {mutation.isPending
            ? t('entry.submitting')
            : canSubmit
              ? `${t('entry.submit')} · NT$${amountVal.toLocaleString()}`
              : t('entry.missingFields', { fields: missing.join('・') })}
        </button>
      </div>
    </form>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export function EntryScreen() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('expense');

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {TABS.map((tb) => (
          <button
            key={tb}
            type="button"
            onClick={() => setTab(tb)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              tab === tb ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 dark:text-gray-400'
            }`}
          >
            {t(TAB_LABEL_KEYS[tb])}
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
