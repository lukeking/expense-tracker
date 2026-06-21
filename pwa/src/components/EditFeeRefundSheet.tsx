import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiFetch, queryClient } from '../api/client';
import { CategoryPicker } from './CategoryPicker';
import type { CategorySelection } from './CategoryPicker';
import { PaymentPills } from './PaymentPills';
import type { PaymentMethod } from './PaymentPills';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

// Dedicated minimal editor for single-line transactions (fee / refund). They have no
// items / adjustments / reconciliation, so they don't go through EditExpenseSheet — this
// edits amount / payment / category / description and PATCHes /pwa/transactions/:id.

type TxDetail = {
  id: string;
  amount: number;
  payment_method: string;
  tags: string[];
  note: string | null;
  transaction_type: string;
};

function parseCategorySelection(tag: string | null): CategorySelection | null {
  if (!tag) return null;
  const idx = tag.indexOf(':');
  if (idx === -1) return { major: tag, subcategory: null };
  return { major: tag.slice(0, idx), subcategory: tag.slice(idx + 1) };
}

function deriveCategoryTag(sel: CategorySelection | null): string | null {
  // A category is only ever `主:子`; a major-only selection emits null (see EntryScreen).
  if (!sel || !sel.subcategory) return null;
  return `${sel.major}:${sel.subcategory}`;
}

function EditFeeRefundFormInner({ tx, onClose }: { tx: TxDetail; onClose: () => void }) {
  const t = useT();
  const categoryTag0 = tx.tags.find((tg) => tg.includes(':')) ?? null;

  const [amount, setAmount] = useState(String(tx.amount));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(tx.payment_method as PaymentMethod);
  const [category, setCategory] = useState<CategorySelection | null>(parseCategorySelection(categoryTag0));
  const [description, setDescription] = useState(tx.note ?? '');

  const amountVal = parseInt(amount, 10) || 0;
  const categoryTag = deriveCategoryTag(category);
  const categoryIncomplete = category !== null && category.subcategory === null;
  const canSubmit = amountVal > 0 && description.trim().length > 0 && !categoryIncomplete;

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/pwa/transactions/${tx.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          amount: amountVal,
          payment_method: paymentMethod,
          category_tag: categoryTag,
          description: description.trim(),
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['summary'] });
      queryClient.invalidateQueries({ queryKey: ['subcategories'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['tx-detail', tx.id] });
      queryClient.invalidateQueries({ queryKey: ['tx-month'] });
      onClose();
    },
  });

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (canSubmit) mutation.mutate(); }}
      className="flex flex-col h-full"
    >
      <div className="flex-1 overflow-y-auto flex flex-col gap-4 p-4">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('entry.amountLabel')}</label>
          <input
            type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)}
            placeholder="0" required
            className="text-3xl font-bold w-full border-b-2 border-gray-300 dark:border-gray-600 outline-none pb-1 focus:border-blue-500 bg-transparent text-gray-900 dark:text-white"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">{t('entry.paymentMethod')}</label>
          <PaymentPills value={paymentMethod} onChange={setPaymentMethod} />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">{t('entry.category')}</label>
          <CategoryPicker value={category} onChange={setCategory} />
          {categoryIncomplete && (
            <p className="text-xs text-orange-500 mt-1">{t('category.subRequired')}</p>
          )}
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{t('entry.description')}</label>
          <input
            type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="p-4 pt-3 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {mutation.error && <p className="text-red-600 text-sm mb-2">{(mutation.error as Error).message}</p>}
        <button
          type="submit"
          disabled={mutation.isPending || !canSubmit}
          className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
        >
          {mutation.isPending ? t('edit.saving') : t('edit.save')}
        </button>
      </div>
    </form>
  );
}

export function EditFeeRefundSheet({ txId, onClose }: { txId: string; onClose: () => void }) {
  const t = useT();
  const { data: tx, isLoading, error } = useQuery({
    queryKey: ['tx-detail', txId],
    queryFn: () => apiFetch<TxDetail>(`/pwa/transactions/${txId}`),
    staleTime: 0,
  });

  const titleKey: MessageKey = tx?.transaction_type === 'refund' ? 'edit.titleRefund' : 'edit.titleFee';

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-gray-900 flex flex-col">
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex-shrink-0">
        <button type="button" onClick={onClose} className="text-blue-600 text-sm">
          {t('common.back')}
        </button>
        <span className="font-semibold text-gray-800 dark:text-gray-100 flex-1">{t(titleKey)}</span>
      </div>
      <div className="flex-1 overflow-hidden">
        {isLoading && (
          <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-500">
            {t('common.loading')}
          </div>
        )}
        {error && (
          <div className="h-full flex items-center justify-center text-red-500 text-sm px-4">
            {t('edit.loadFailed', { msg: (error as Error).message })}
          </div>
        )}
        {tx && <EditFeeRefundFormInner tx={tx} onClose={onClose} />}
      </div>
    </div>
  );
}
