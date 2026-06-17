import { useEffect, useMemo, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import { BottomSheet } from './BottomSheet';
import type { MatchedDetail } from './AmbiguousInvoiceCard';
import { useT } from '../i18n';

// Full unmatched-invoice payload, carried from the import response (FR-007: not
// persisted until linked). Mirrors the backend UnmatchedInvoiceDetail.
export interface UnmatchedInvoice {
  invoice_number: string;
  seller_name: string;
  seller_tax_id: string;
  invoice_date: string;
  gross_amount: number;
  allowance: number;
  net_amount: number;
  invoice_status: 'active' | 'voided';
  items: { name: string; quantity: number; unit_price: number; amount: number }[];
}

// What the sheet needs to display, regardless of source.
export interface ManualLinkInvoice {
  invoice_number: string;
  seller_name: string | null;
  invoice_date: string;
  net_amount: number;
  items: { name: string; amount: number | null }[];
}

// How the link is posted: a not-yet-persisted unmatched invoice (insert), or an
// already-persisted ambiguous invoice (reuse the row).
export type ManualLinkSource =
  | { kind: 'unmatched'; payload: UnmatchedInvoice; importRunId: string }
  | { kind: 'ambiguous'; invoiceId: string };

interface Candidate {
  id: string;
  transaction_at: string;
  amount: number;
  note: string | null;
  tags: string[];
  items: { id: string; name: string; amount: number | null }[];
}

function fmtDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function ManualLinkSheet({
  invoice,
  source,
  onClose,
  onLinked,
}: {
  invoice: ManualLinkInvoice;
  source: ManualLinkSource;
  onClose: () => void;
  onLinked: (resolved: MatchedDetail) => void;
}) {
  const t = useT();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  // US3: map an existing transaction item id → an invoice line index to rename it to.
  const [renameMap, setRenameMap] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset the per-item rename choices whenever the chosen transaction changes (item ids
  // are specific to that transaction).
  useEffect(() => {
    setRenameMap({});
  }, [selected]);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch<{ candidates: Candidate[] }>(
          `/pwa/import/link-candidates?date=${encodeURIComponent(invoice.invoice_date)}&window=7`
        );
        setCandidates(data.candidates);
      } catch {
        setError(t('import.loadCandidatesFailed'));
      } finally {
        setLoading(false);
      }
    })();
  }, [invoice.invoice_date]);

  const selectedTx = candidates.find((c) => c.id === selected) ?? null;

  // Dup guard: disable invoice items whose name already exists on the chosen tx.
  const existingNames = useMemo(
    () => new Set((selectedTx?.items ?? []).map((i) => i.name)),
    [selectedTx]
  );
  const isDisabled = (idx: number) => existingNames.has(invoice.items[idx].name);

  const filtered = candidates.filter((c) => {
    if (!filter.trim()) return true;
    const hay = `${c.note ?? ''} ${c.tags.join(' ')} ${c.items.map((i) => i.name).join(' ')}`.toLowerCase();
    return hay.includes(filter.trim().toLowerCase());
  });

  function toggleItem(idx: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function setRename(itemId: string, value: string) {
    setRenameMap((prev) => {
      const next = { ...prev };
      if (value === '') delete next[itemId];
      else next[itemId] = Number(value);
      return next;
    });
  }

  const effectiveChecked = [...checked].filter((idx) => !isDisabled(idx));
  const checkedSum = effectiveChecked.reduce((s, idx) => s + (invoice.items[idx].amount || 0), 0);
  const existingSum = (selectedTx?.items ?? []).reduce((s, i) => s + (i.amount || 0), 0);

  const amountMismatch = selectedTx != null && selectedTx.amount !== invoice.net_amount;
  const itemSumMismatch = selectedTx != null && effectiveChecked.length > 0 && existingSum + checkedSum !== selectedTx.amount;

  async function handleConfirm() {
    if (!selected) return;
    setSubmitting(true);
    setError('');
    const linkFields =
      source.kind === 'unmatched'
        ? { invoice: source.payload, import_run_id: source.importRunId }
        : { invoice_id: source.invoiceId };
    const replace = Object.entries(renameMap).map(([item_id, invoice_item_index]) => ({ item_id, invoice_item_index }));
    try {
      const data = await apiFetch<{ resolved: MatchedDetail }>('/pwa/import/manual-link', {
        method: 'POST',
        body: JSON.stringify({ ...linkFields, transaction_id: selected, item_indexes: effectiveChecked, replace }),
      });
      onLinked(data.resolved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.linkFailed'));
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open onClose={onClose} title={t('import.manualLinkTitle')}>
      <div className="flex flex-col gap-4 p-4">
        {/* Invoice header */}
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {invoice.seller_name || t('import.unknownSeller')} · NT${invoice.net_amount.toLocaleString()}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {invoice.invoice_number} · {invoice.invoice_date.slice(0, 10)}
          </p>
          {invoice.items.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {invoice.items.map((i) => `${i.name} (${i.amount ?? '—'})`).join('、')}
            </p>
          )}
        </div>

        {/* Transaction picker */}
        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-500 dark:text-gray-400">{t('import.selectTx')}</label>
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('import.filterPlaceholder')}
            className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
          />
          {loading ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('common.loading')}</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('import.noUnlinkedInRange')}</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
              {filtered.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-sm cursor-pointer py-1">
                  <input
                    type="radio"
                    name="manual-cand"
                    checked={selected === c.id}
                    onChange={() => setSelected(c.id)}
                    className="mt-1"
                  />
                  <span className="text-gray-700 dark:text-gray-200">
                    NT${c.amount.toLocaleString()} · {fmtDate(c.transaction_at)}
                    {c.tags.length > 0 ? ` · ${c.tags.join('/')}` : ''}
                    {c.note ? ` · ${c.note}` : ''}
                    {c.items.length > 0 && (
                      <span className="block text-xs text-gray-400 dark:text-gray-500">
                        {c.items.map((i) => i.name).join('、')}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}
          {amountMismatch && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              {t('import.amountMismatch', { inv: invoice.net_amount.toLocaleString(), tx: selectedTx!.amount.toLocaleString() })}
            </p>
          )}
        </div>

        {/* Item selection */}
        {invoice.items.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">{t('import.addInvoiceItems')}</label>
            {invoice.items.map((it, idx) => {
              const disabled = isDisabled(idx);
              return (
                <label
                  key={idx}
                  className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={checked.has(idx) && !disabled}
                    onChange={() => toggleItem(idx)}
                  />
                  <span className="text-gray-700 dark:text-gray-200">
                    {it.name} · NT${(it.amount ?? 0).toLocaleString()}
                    {disabled && <span className="text-xs text-gray-400 dark:text-gray-500">{t('import.dupItemName')}</span>}
                  </span>
                </label>
              );
            })}
            {itemSumMismatch && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t('import.itemSumMismatch', { items: (existingSum + checkedSum).toLocaleString(), paid: selectedTx!.amount.toLocaleString() })}
              </p>
            )}
          </div>
        )}

        {/* Per-item rename: point an invoice line at an existing item to replace its
            name only (amount/tags unchanged). Distinct from the append checkboxes (US3). */}
        {selectedTx && selectedTx.items.length > 0 && invoice.items.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500 dark:text-gray-400">{t('import.renameItems')}</label>
            {selectedTx.items.map((exItem) => (
              <div key={exItem.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-gray-700 dark:text-gray-200 truncate">
                  {exItem.name}{exItem.amount != null ? ` · NT$${exItem.amount.toLocaleString()}` : ''}
                </span>
                <select
                  value={exItem.id in renameMap ? String(renameMap[exItem.id]) : ''}
                  onChange={(e) => setRename(exItem.id, e.target.value)}
                  className="shrink-0 border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
                >
                  <option value="">{t('import.noReplace')}</option>
                  {invoice.items.map((li, idx) => (
                    <option key={idx} value={idx}>{li.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <button
          type="button"
          onClick={handleConfirm}
          disabled={!selected || submitting}
          className="bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {submitting ? t('import.linking') : t('import.confirmLink')}
        </button>
      </div>
    </BottomSheet>
  );
}
