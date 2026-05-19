import type { WindowOption } from '../hooks/useSummary';

interface Props {
  value: WindowOption;
  onChange: (window: WindowOption) => void;
}

const OPTIONS: { value: WindowOption; label: string }[] = [
  { value: 'month', label: '本月' },
  { value: 'last-month', label: '上月' },
  { value: '3months', label: '近3個月' },
  { value: 'half-year', label: '近半年' },
  { value: 'year', label: '近一年' },
  { value: 'all', label: '全部' },
];

export function TimeWindowPicker({ value, onChange }: Props) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 px-4 scrollbar-none">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            value === opt.value
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-600 border-gray-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
