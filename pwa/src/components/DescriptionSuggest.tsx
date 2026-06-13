import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

interface Props {
  value: string;
  onChange: (v: string) => void;
  type: 'fee' | 'refund';
  placeholder?: string;
  required?: boolean;
}

export function DescriptionSuggest({ value, onChange, type, placeholder, required }: Props) {
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['descriptions', type],
    queryFn: () => apiFetch<{ descriptions: string[] }>(`/pwa/descriptions?type=${type}`),
  });

  const q = value.trim().toLowerCase();
  const suggestions = (data?.descriptions ?? []).filter(
    (s) => s.toLowerCase() !== q && (q === '' || s.toLowerCase().includes(q))
  );

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder}
        required={required}
        className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm outline-none bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute z-10 top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-md max-h-48 overflow-y-auto">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(s); setOpen(false); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 border-b border-gray-50 dark:border-gray-700 last:border-0 truncate"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
