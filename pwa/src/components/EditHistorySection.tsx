import { useState } from 'react';

type EditDiff = {
  header?: Record<string, { before: unknown; after: unknown }>;
  items?: { before: unknown[]; after: unknown[] };
  adjustments?: { before: unknown[]; after: unknown[] };
};

type HistoryEntry = { id: string; edited_at: string; diff: EditDiff };

const HEADER_LABELS: Record<string, string> = {
  amount:         '金額',
  payment_method: '付款方式',
  note:           '備註',
  tags:           '標籤',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '（空）';
  if (Array.isArray(v)) return v.length === 0 ? '（空）' : v.join(', ');
  return String(v);
}

function DiffSummary({ diff }: { diff: EditDiff }) {
  return (
    <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 space-y-0.5">
      {diff.header && Object.entries(diff.header).map(([key, { before, after }]) => (
        <div key={key}>
          <span className="font-medium">{HEADER_LABELS[key] ?? key}</span>
          {': '}
          <span className="line-through text-gray-400">{formatValue(before)}</span>
          {' → '}
          <span>{formatValue(after)}</span>
        </div>
      ))}
      {diff.items && (
        <div>
          <span className="font-medium">品項</span>
          {': '}
          {diff.items.before.length} 項 → {diff.items.after.length} 項
        </div>
      )}
      {diff.adjustments && (
        <div>
          <span className="font-medium">折抵</span>
          {': '}
          {diff.adjustments.before.length} 筆 → {diff.adjustments.after.length} 筆
        </div>
      )}
    </div>
  );
}

export function EditHistorySection({ history }: { history: HistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false);

  if (history.length === 0) return null;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        <span>編輯紀錄 ({history.length})</span>
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
