import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

export type AdjustmentKind = 'discount' | 'fee' | 'refund';
export type AdjustmentMode = 'absolute' | 'percentage';

export interface AdjustmentRowData {
  id: string;
  kind: AdjustmentKind;
  mode: AdjustmentMode;
  value: number | null;
  note: string;
}

export const KIND_LABEL_KEYS: Record<AdjustmentKind, MessageKey> = {
  discount: 'adj.discount',
  fee: 'adj.fee',
  refund: 'adj.refund',
};

export function resolveAdjAmount(a: AdjustmentRowData, base: number): number | null {
  if (a.value == null) return null;
  if (a.mode === 'absolute') return a.value;
  return base > 0 ? Math.round(base * a.value / 100) : null;
}

interface Props {
  adj: AdjustmentRowData;
  base: number;
  onChange: (a: AdjustmentRowData) => void;
  onRemove: () => void;
}

export function AdjustmentRow({ adj, base, onChange, onRemove }: Props) {
  const t = useT();
  const derivedAmount = resolveAdjAmount(adj, base);

  function toggleMode() {
    const next: AdjustmentMode = adj.mode === 'absolute' ? 'percentage' : 'absolute';
    onChange({ ...adj, mode: next, value: null });
  }

  function handleValueChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = parseInt(e.target.value, 10);
    const max = adj.mode === 'percentage' ? 100 : Infinity;
    const v = isNaN(raw) || raw <= 0 ? null : Math.min(raw, max);
    onChange({ ...adj, value: v });
  }

  const pillBase = 'px-2 py-1 text-xs leading-none transition-colors';
  const pillActive = 'bg-blue-600 text-white';
  const pillInactive = 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200';

  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      <select
        value={adj.kind}
        onChange={(e) => onChange({ ...adj, kind: e.target.value as AdjustmentKind })}
        className="border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shrink-0"
      >
        {(Object.keys(KIND_LABEL_KEYS) as AdjustmentKind[]).map((k) => (
          <option key={k} value={k}>{t(KIND_LABEL_KEYS[k])}</option>
        ))}
      </select>

      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 shrink-0">
        <button type="button" onClick={() => adj.mode !== 'absolute' && toggleMode()} className={`${pillBase} ${adj.mode === 'absolute' ? pillActive : pillInactive}`}>NT$</button>
        <button type="button" onClick={() => adj.mode !== 'percentage' && toggleMode()} className={`${pillBase} ${adj.mode === 'percentage' ? pillActive : pillInactive}`}>%</button>
      </div>

      <input
        type="number"
        min="1"
        max={adj.mode === 'percentage' ? 100 : undefined}
        step={adj.mode === 'percentage' ? 1 : undefined}
        value={adj.value ?? ''}
        onChange={handleValueChange}
        placeholder={adj.mode === 'absolute' ? t('adj.amountPlaceholder') : t('adj.percentPlaceholder')}
        className="w-20 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />

      {adj.mode === 'percentage' && (
        <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0">
          = {derivedAmount != null ? `NT$${derivedAmount}` : '—'}
        </span>
      )}

      <input
        type="text"
        value={adj.note}
        onChange={(e) => onChange({ ...adj, note: e.target.value })}
        placeholder={t('adj.notePlaceholder')}
        className="flex-1 min-w-40 border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />

      <button
        type="button"
        onClick={onRemove}
        className="text-gray-400 hover:text-red-500 shrink-0 text-lg leading-none"
        aria-label={t('common.remove')}
      >
        ×
      </button>
    </div>
  );
}
