import { useState } from 'react';

const PM_LABELS: Record<string, string> = {
  credit_card: '信用卡',
  cash: '現金',
  prepaid_wallet: '儲值卡',
  easy_card: '悠遊卡',
  bank_account: '銀行帳戶',
};

const TAG_SEARCH_THRESHOLD = 6; // show search input when more than this many tags

interface FilterBarProps {
  tags: string[];
  paymentMethods: string[];
  activeTag: string | null;
  activePayment: string | null;
  onTagChange: (tag: string | null) => void;
  onPaymentChange: (pm: string | null) => void;
}

export function FilterBar({ tags, paymentMethods, activeTag, activePayment, onTagChange, onPaymentChange }: FilterBarProps) {
  const [tagSearch, setTagSearch] = useState('');

  if (tags.length === 0 && paymentMethods.length === 0) return null;

  const showSearch = tags.length > TAG_SEARCH_THRESHOLD;
  const visibleTags = showSearch && tagSearch.trim()
    ? tags.filter((t) => t.toLowerCase().includes(tagSearch.trim().toLowerCase()))
    : tags;

  return (
    <div className="px-4 pb-2 space-y-1.5">
      {tags.length > 0 && (
        <div className="space-y-1">
          {showSearch && (
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs pointer-events-none">🔍</span>
              <input
                type="text"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                placeholder="搜尋標籤…"
                className="w-full pl-7 pr-3 py-1 text-xs rounded-full border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 outline-none focus:border-blue-400"
              />
              {tagSearch && (
                <button
                  type="button"
                  onClick={() => setTagSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"
                >
                  ✕
                </button>
              )}
            </div>
          )}
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
            {visibleTags.length === 0 ? (
              <span className="text-xs text-gray-400 dark:text-gray-500 py-1">無符合標籤</span>
            ) : (
              visibleTags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => onTagChange(activeTag === t ? null : t)}
                  className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    activeTag === t
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                  }`}
                >
                  #{t}
                </button>
              ))
            )}
          </div>
        </div>
      )}
      {paymentMethods.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {paymentMethods.map((pm) => (
            <button
              key={pm}
              type="button"
              onClick={() => onPaymentChange(activePayment === pm ? null : pm)}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                activePayment === pm
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
              }`}
            >
              {PM_LABELS[pm] ?? pm}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
