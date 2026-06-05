import { useState } from 'react';
import { apiFetch, ApiError } from '../api/client';

export interface MatchedDetail {
  seller_name: string | null;
  invoice_number: string;
  transaction_at: string;
  amount: number;
  confidence: 'exact' | 'near';
  items_outcome: 'filled' | 'kept' | 'replaced';
}

interface Candidate {
  id: string;
  transaction_at: string;
  amount: number;
  note: string | null;
  items: { name: string; amount: number | null }[];
}

export interface AmbiguousEntry {
  id: string;
  invoice_number: string;
  seller_name: string | null;
  invoice_date: string;
  net_amount: number;
  items: { name: string; amount: number | null }[] | null;
  candidate_source: 'exact' | 'forex';
  candidates: Candidate[];
}

function fmtDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function AmbiguousInvoiceCard({ entry, onResolved, onManualLink }: { entry: AmbiguousEntry; onResolved: (r: MatchedDetail) => void; onManualLink: () => void }) {
  const [selected, setSelected] = useState<string | null>(entry.candidates[0]?.id ?? null);
  const [replaceItems, setReplaceItems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleConfirm() {
    if (!selected) return;
    setSubmitting(true);
    setError('');
    try {
      const data = await apiFetch<{ resolved: MatchedDetail }>('/pwa/import/resolve', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: entry.id, transaction_id: selected, replace_items: replaceItems }),
      });
      onResolved(data.resolved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '連結失敗，請重試');
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {entry.seller_name || '未知商家'} · NT${entry.net_amount.toLocaleString()}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {entry.invoice_number} · {entry.invoice_date}
          {entry.candidate_source === 'forex' && <span className="ml-1 text-amber-600 dark:text-amber-400">（外幣近似）</span>}
        </p>
      </div>

      {entry.candidates.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500">目前無可連結的交易（候選可能已被其他發票連結）。</p>
      ) : (
        <div className="flex flex-col gap-2">
          {entry.candidates.map((cand) => (
            <label key={cand.id} className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name={`cand-${entry.id}`}
                checked={selected === cand.id}
                onChange={() => setSelected(cand.id)}
                className="mt-1"
              />
              <span className="text-gray-700 dark:text-gray-200">
                NT${cand.amount.toLocaleString()} · {fmtDate(cand.transaction_at)}
                {cand.note ? ` · ${cand.note}` : ''}
                {cand.items.length > 0 && (
                  <span className="block text-xs text-gray-400 dark:text-gray-500">
                    {cand.items.map((i) => i.name).join('、')}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {entry.candidates.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
            <input type="checkbox" checked={replaceItems} onChange={(e) => setReplaceItems(e.target.checked)} />
            以發票項目取代既有項目
          </label>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!selected || submitting}
            className="bg-blue-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? '處理中…' : '確認連結'}
          </button>
        </>
      )}

      <button
        type="button"
        onClick={onManualLink}
        className="text-xs text-blue-600 dark:text-blue-400 underline self-start"
      >
        都不對？手動連結到其他交易
      </button>
    </div>
  );
}
