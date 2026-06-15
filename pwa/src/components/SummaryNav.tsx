import type { TimeBase } from '../hooks/useSummary';
import { timeBaseToRange } from '../hooks/useSummary';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

interface SummaryNavProps {
  timeBase: TimeBase;
  offset: number;
  onTimeBaseChange: (base: TimeBase) => void;
  onNavigate: (delta: -1 | 1) => void;
  onPickerOpen: () => void;
}

const TABS: { value: TimeBase; labelKey: MessageKey }[] = [
  { value: 'week', labelKey: 'summary.tabWeek' },
  { value: 'month', labelKey: 'summary.tabMonth' },
  { value: 'year', labelKey: 'summary.tabYear' },
  { value: 'all', labelKey: 'summary.tabAll' },
];

export function SummaryNav({ timeBase, offset, onTimeBaseChange, onNavigate, onPickerOpen }: SummaryNavProps) {
  const t = useT();
  const { label } = timeBaseToRange(timeBase, offset);
  const atPresent = offset === 0;

  return (
    <div className="px-4 pt-3 pb-1 space-y-2">
      {/* Time-base tabs */}
      <div className="flex gap-1.5">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onTimeBaseChange(tab.value)}
            className={`flex-1 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              timeBase === tab.value
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* Navigation row — hidden in all-time mode */}
      {timeBase !== 'all' && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => onNavigate(-1)}
            className="p-2 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100"
            aria-label={t('summary.prevPeriod')}
          >
            ◀
          </button>
          <button
            type="button"
            onClick={onPickerOpen}
            className="flex-1 text-center text-sm font-semibold text-gray-800 dark:text-gray-100 py-1"
            aria-label={t('summary.selectPeriod')}
          >
            {label}
          </button>
          <button
            type="button"
            onClick={() => onNavigate(1)}
            disabled={atPresent}
            className={`p-2 transition-opacity ${atPresent ? 'opacity-30 pointer-events-none' : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100'}`}
            aria-label={t('summary.nextPeriod')}
          >
            ▶
          </button>
        </div>
      )}
    </div>
  );
}
