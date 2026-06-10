import { useState } from 'react';
import { ItemCategorySheet } from './ItemCategorySheet';
import { EXPLICIT_UNCATEGORIZED } from '../lib/itemCategory';

export interface ItemRowData {
  id: string;
  tagOverride: string | null;
  name: string;
  amount: number | null;
  note: string;
  approxFlag: boolean;
}

interface Props {
  item: ItemRowData;
  inheritedTag: string | null;
  extraTags?: string[];
  onMax: (() => void) | null;
  onChange: (item: ItemRowData) => void;
  onRemove?: () => void;
}

export function ItemRow({ item, inheritedTag, extraTags = [], onMax, onChange, onRemove }: Props) {
  const [tagSheetOpen, setTagSheetOpen] = useState(false);

  // B2: the sentinel is a deliberate decision — rendered like an override, as 其他.
  const isSentinel = item.tagOverride === EXPLICIT_UNCATEGORIZED;
  const displayTag = isSentinel ? '其他' : item.tagOverride ?? inheritedTag;

  function setAmount(val: number | null) {
    onChange({ ...item, amount: val, approxFlag: false });
  }

  function increment() {
    setAmount(item.amount === null ? 1 : item.amount + 1);
  }

  function decrement() {
    if (item.amount === null) return;
    if (item.amount <= 1) {
      setAmount(null);
    } else {
      setAmount(item.amount - 1);
    }
  }

  function handleAmountInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw === '' || raw === '0') {
      setAmount(null);
      return;
    }
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) setAmount(parsed);
  }

  function selectTag(tag: string | null) {
    onChange({ ...item, tagOverride: tag });
    setTagSheetOpen(false);
  }

  return (
    <div className="flex flex-col gap-1 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      {/* Line 1: tag, name, −, amount, +, × */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setTagSheetOpen(true)}
          className={`flex-shrink-0 text-xs px-2 py-1 rounded border truncate max-w-[80px] ${
            item.tagOverride
              ? 'border-blue-400 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30'
              : 'border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500'
          }`}
          title={displayTag ?? '繼承分類'}
        >
          {isSentinel ? '其他' : item.tagOverride ?? (inheritedTag ? <span className="text-gray-300 dark:text-gray-600">{inheritedTag}</span> : '—')}
        </button>

        <input
          type="text"
          value={item.name}
          onChange={(e) => onChange({ ...item, name: e.target.value })}
          placeholder="品項名稱"
          className="flex-1 min-w-0 text-sm border-0 outline-none bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600"
        />

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={decrement}
            className="w-7 h-7 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 text-lg leading-none"
          >
            −
          </button>
          <input
            type="number"
            min="1"
            value={item.amount ?? ''}
            onChange={handleAmountInput}
            placeholder="—"
            className="w-14 text-center text-sm border-b border-gray-300 dark:border-gray-600 outline-none bg-transparent text-gray-900 dark:text-gray-100"
          />
          <button
            type="button"
            onClick={increment}
            className="w-7 h-7 rounded-full border border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-600 dark:text-gray-300 text-lg leading-none"
          >
            ＋
          </button>
        </div>

        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="flex-shrink-0 text-gray-400 dark:text-gray-500 text-lg leading-none ml-1"
            aria-label="移除"
          >
            ✕
          </button>
        )}
      </div>

      {/* Line 2: note input + Max button */}
      <div className="flex items-center gap-2 pl-1">
        <input
          type="text"
          value={item.note}
          onChange={(e) => onChange({ ...item, note: e.target.value })}
          placeholder="備註"
          maxLength={200}
          className="flex-1 text-xs border-0 outline-none bg-transparent text-gray-500 dark:text-gray-400 placeholder-gray-300 dark:placeholder-gray-600"
        />
        <button
          type="button"
          onClick={() => onMax?.()}
          disabled={onMax === null}
          className="flex-shrink-0 text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 disabled:opacity-30"
        >
          {item.approxFlag ? '≈Max' : 'Max'}
        </button>
      </div>

      {/* Tag override sheet (searchable + major-filterable) */}
      <ItemCategorySheet
        open={tagSheetOpen}
        onClose={() => setTagSheetOpen(false)}
        value={item.tagOverride}
        inheritedTag={inheritedTag}
        extraTags={extraTags}
        onSelect={selectTag}
      />
    </div>
  );
}
