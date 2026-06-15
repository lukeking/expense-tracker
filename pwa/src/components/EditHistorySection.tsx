import { useState } from 'react';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

type EditDiff = {
  header?: Record<string, { before: unknown; after: unknown }>;
  items?: { before: unknown[]; after: unknown[] };
  adjustments?: { before: unknown[]; after: unknown[] };
};

type HistoryEntry = { id: string; edited_at: string; diff: EditDiff };

const HEADER_LABEL_KEYS: Record<string, MessageKey> = {
  amount:         'editHist.amount',
  payment_method: 'entry.paymentMethod',
  note:           'entry.note',
  tags:           'entry.tags',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatValue(v: unknown, emptyLabel: string): string {
  if (v === null || v === undefined) return emptyLabel;
  if (Array.isArray(v)) return v.length === 0 ? emptyLabel : v.join(', ');
  return String(v);
}

function DiffSummary({ diff }: { diff: EditDiff }) {
  const t = useT();
  const empty = t('editHist.empty');
  return (
    <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
      {diff.header && Object.entries(diff.header).map(([key, { before, after }]) => (
        <div key={key}>
          <span className="font-medium">{HEADER_LABEL_KEYS[key] ? t(HEADER_LABEL_KEYS[key]) : key}</span>
          {': '}
          <span className="line-through text-gray-400">{formatValue(before, empty)}</span>
          {' → '}
          <span>{formatValue(after, empty)}</span>
        </div>
      ))}
      {diff.items && (
        <div>
          <span className="font-medium">{t('editHist.items')}</span>
          {': '}
          {t('editHist.itemsCount', { n: diff.items.before.length })} → {t('editHist.itemsCount', { n: diff.items.after.length })}
        </div>
      )}
      {diff.adjustments && (
        <div>
          <span className="font-medium">{t('editHist.adjustments')}</span>
          {': '}
          {t('editHist.adjCount', { n: diff.adjustments.before.length })} → {t('editHist.adjCount', { n: diff.adjustments.after.length })}
        </div>
      )}
    </div>
  );
}

export function EditHistorySection({ history }: { history: HistoryEntry[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);

  if (history.length === 0) return null;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        <span>{t('editHist.title')} ({history.length})</span>
        <span>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-800">
          {history.map((entry) => (
            <div key={entry.id} className="px-3 py-2">
              <div className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(entry.edited_at)}</div>
              <DiffSummary diff={entry.diff} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
