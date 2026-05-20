import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { useCategories, useMajors } from '../hooks/useCategories';

export interface ItemRowData {
  id: string;
  tagOverride: string | null;
  name: string;
  amount: number | null;
}

interface Props {
  item: ItemRowData;
  inheritedTag: string | null;
  extraTags?: string[];
  onChange: (item: ItemRowData) => void;
  onRemove: () => void;
}

export function ItemRow({ item, inheritedTag, extraTags = [], onChange, onRemove }: Props) {
  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const { data: categories } = useCategories();
  const majors = useMajors(categories);

  const displayTag = item.tagOverride ?? inheritedTag;

  function setAmount(val: number | null) {
    onChange({ ...item, amount: val });
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

  const dbOptions: string[] = [
    ...(majors ?? []),
    ...((categories ?? [])
      .filter((c) => c.subcategory !== null)
      .map((c) => `${c.major}:${c.subcategory}`)),
  ];
  const allTagOptions = [...new Set([...dbOptions, ...extraTags.filter((t) => t.includes(':'))])];

  return (
    <div className="flex items-center gap-2 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      {/* Tag selector */}
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
        {item.tagOverride ?? (inheritedTag ? <span className="text-gray-300 dark:text-gray-600">{inheritedTag}</span> : '—')}
      </button>

      {/* Name input */}
      <input
        type="text"
        value={item.name}
        onChange={(e) => onChange({ ...item, name: e.target.value })}
        placeholder="品項名稱"
        className="flex-1 text-sm border-0 outline-none bg-transparent text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600"
      />

      {/* Amount stepper */}
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

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        className="flex-shrink-0 text-gray-400 dark:text-gray-500 text-lg leading-none ml-1"
        aria-label="移除"
      >
        ✕
      </button>

      {/* Tag override sheet */}
      <BottomSheet open={tagSheetOpen} onClose={() => setTagSheetOpen(false)} title="選擇品項分類">
        <div className="px-4 py-3 space-y-1">
          <button
            type="button"
            onClick={() => selectTag(null)}
            className={`w-full text-left px-3 py-2 rounded text-sm ${!item.tagOverride ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            繼承主分類{inheritedTag ? `（${inheritedTag}）` : ''}
          </button>
          {allTagOptions.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => selectTag(tag)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${item.tagOverride === tag ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
            >
              {tag}
            </button>
          ))}
        </div>
      </BottomSheet>
    </div>
  );
}
