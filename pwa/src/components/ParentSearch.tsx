import { useState, useCallback } from 'react';
import { apiFetch } from '../api/client';
import { useT } from '../i18n';

export interface ParentSearchResult {
  id: string;
  amount: number;
  note: string | null;
  tags: string[];
  transaction_at: string;
  item_names: string[];
  payment_method: string;
  category: string | null;
}

interface Props {
  value: ParentSearchResult | null;
  onSelect: (result: ParentSearchResult | null) => void;
}

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: T) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function ParentSearch({ value, onSelect }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ParentSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [allDays, setAllDays] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const search = useCallback(
    debounce(async (q: string, days: boolean) => {
      if (!q.trim()) { setResults([]); setSearched(false); return; }
      setLoading(true);
      try {
        const daysParam = days ? 'all' : '90';
        const data = await apiFetch<{ transactions: ParentSearchResult[] }>(
          `/pwa/parent-search?q=${encodeURIComponent(q.trim())}&days=${daysParam}`
        );
        setResults(data.transactions);
        setSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    setAllDays(false);
    setShowDropdown(true);
    search(q, false);
  }

  function selectResult(result: ParentSearchResult) {
    onSelect(result);
    setShowDropdown(false);
  }

  function searchAll() {
    setAllDays(true);
    search(query, true);
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 border border-blue-300 bg-blue-50 dark:bg-blue-900/30 rounded-lg px-3 py-2 text-sm">
        <div className="flex-1 min-w-0">
          <p className="text-blue-800 dark:text-blue-300 font-medium truncate">
            {value.note ?? value.item_names[0] ?? value.tags[0] ?? value.id.slice(0, 8)}
          </p>
          <p className="text-blue-600 dark:text-blue-400 text-xs">NT${value.amount}</p>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="text-blue-400 text-lg leading-none"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={query}
        onChange={handleInput}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={t('parentSearch.placeholder')}
        className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500"
      />
      {showDropdown && query.trim() && (
        <div className="absolute z-10 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md max-h-48 overflow-y-auto">
          {loading && <p className="px-3 py-2 text-sm text-gray-400 dark:text-gray-500">{t('common.searching')}</p>}
          {!loading && results.length === 0 && searched && (
            <div className="px-3 py-2">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('parentSearch.noResults90')}</p>
              {!allDays && (
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); searchAll(); }}
                  className="text-sm text-blue-600 mt-1"
                >
                  {t('parentSearch.searchEarlier')}
                </button>
              )}
            </div>
          )}
          {results.map((result) => (
            <button
              key={result.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); selectResult(result); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-50 dark:border-gray-700 last:border-0"
            >
              <p className="text-sm text-gray-800 dark:text-gray-100 font-medium truncate">
                {result.note ?? result.item_names[0] ?? result.tags[0] ?? t('parentSearch.noNote')}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                NT${result.amount} · {(() => { const d = new Date(result.transaction_at); const pad = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; })()}
                {result.item_names.length > 0 && ` · ${result.item_names.slice(0, 2).join(', ')}`}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
