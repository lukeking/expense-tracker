import { useState } from 'react';
import type { TimeBase } from '../hooks/useSummary';
import { timeBaseToRange } from '../hooks/useSummary';
import { useT } from '../i18n';

interface PeriodPickerProps {
  timeBase: 'week' | 'month' | 'year';
  currentOffset: number;
  onSelect: (offset: number) => void;
  onClose: () => void;
}

const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
const EARLIEST_YEAR = 2015;

function getWeeksInMonth(year: number, month: number): { from: string; to: string; label: string }[] {
  const weeks: { from: string; to: string; label: string }[] = [];
  // Find first Sunday on or before the 1st of the month
  const first = new Date(year, month, 1);
  const startDow = first.getDay(); // 0=Sun
  // First week start = first Sunday at or before month start
  let sunDate = 1 - startDow; // may be ≤0 (prev month)

  for (let i = 0; i < 6; i++) {
    const sun = new Date(year, month, sunDate + i * 7);
    const sat = new Date(sun.getFullYear(), sun.getMonth(), sun.getDate() + 6);
    // Only include weeks that overlap with the target month
    if (sun.getMonth() > month && sun.getFullYear() >= year) break;
    if (sat < new Date(year, month, 1)) continue;
    const pad = (n: number) => String(n).padStart(2, '0');
    const from = `${sun.getFullYear()}-${pad(sun.getMonth()+1)}-${pad(sun.getDate())}`;
    const to = `${sat.getFullYear()}-${pad(sat.getMonth()+1)}-${pad(sat.getDate())}`;
    const label = `${sun.getMonth()+1}/${sun.getDate()} – ${sat.getMonth()+1}/${sat.getDate()}`;
    weeks.push({ from, to, label });
  }
  return weeks;
}

function offsetForWeek(from: string): number {
  const now = new Date();
  const dow = now.getDay();
  const thisSunMs = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow).getTime();
  const targetMs = new Date(from).getTime();
  return Math.round((targetMs - thisSunMs) / (7 * 86400000));
}

function offsetForMonth(year: number, month: number): number {
  const now = new Date();
  return (year - now.getFullYear()) * 12 + (month - now.getMonth());
}

function offsetForYear(year: number): number {
  return year - new Date().getFullYear();
}

export function PeriodPicker({ timeBase, currentOffset, onSelect, onClose }: PeriodPickerProps) {
  const t = useT();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();

  // Derive the currently-displayed year from offset
  const initialYear = (() => {
    if (timeBase === 'year') return currentYear + currentOffset;
    if (timeBase === 'month') {
      const { from } = timeBaseToRange('month', currentOffset);
      return parseInt(from.slice(0, 4));
    }
    return currentYear;
  })();

  const [step, setStep] = useState<1 | 2>(timeBase === 'year' ? 1 : 1);
  const [selectedYear, setSelectedYear] = useState(initialYear);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  const years = Array.from({ length: currentYear - EARLIEST_YEAR + 1 }, (_, i) => EARLIEST_YEAR + i).reverse();

  function handleYearTap(year: number) {
    if (timeBase === 'year') {
      onSelect(offsetForYear(year));
      onClose();
    } else {
      setSelectedYear(year);
      setStep(2);
    }
  }

  function handleMonthTap(monthIdx: number) {
    onSelect(offsetForMonth(selectedYear, monthIdx));
    onClose();
  }

  function handleWeekTap(from: string) {
    onSelect(offsetForWeek(from));
    onClose();
  }

  const weeks = timeBase === 'week' ? getWeeksInMonth(selectedYear, selectedMonth) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-white dark:bg-gray-900 rounded-t-2xl pb-safe max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          {step === 2 ? (
            <button type="button" onClick={() => setStep(1)} className="text-blue-600 text-sm">{t('common.back')}</button>
          ) : (
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t('summary.selectPeriod')}</span>
          )}
          <button type="button" onClick={onClose} className="text-gray-400 dark:text-gray-500 text-lg leading-none">✕</button>
        </div>

        {/* Step 1 — Year list */}
        {step === 1 && (
          <div className="overflow-y-auto flex-1">
            {years.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => handleYearTap(year)}
                className={`w-full text-left px-6 py-3 text-base border-b border-gray-50 dark:border-gray-800 ${
                  year === selectedYear
                    ? 'text-blue-600 font-semibold'
                    : 'text-gray-800 dark:text-gray-200'
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        )}

        {/* Step 2 — Month grid (month mode) */}
        {step === 2 && timeBase === 'month' && (
          <div className="p-4 grid grid-cols-3 gap-2 overflow-y-auto flex-1">
            {MONTH_NAMES.map((name, idx) => {
              const isFuture = selectedYear === currentYear && idx > currentMonth;
              return (
                <button
                  key={idx}
                  type="button"
                  disabled={isFuture}
                  onClick={() => handleMonthTap(idx)}
                  className={`py-3 rounded-lg text-sm font-medium border transition-colors ${
                    isFuture
                      ? 'opacity-30 cursor-not-allowed border-gray-100 dark:border-gray-700 text-gray-400'
                      : selectedYear === currentYear && idx === currentMonth
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600'
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        )}

        {/* Step 2 — Week list (week mode) */}
        {step === 2 && timeBase === 'week' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Month tabs */}
            <div className="flex gap-1 overflow-x-auto px-4 py-2 scrollbar-none border-b border-gray-100 dark:border-gray-700">
              {MONTH_NAMES.map((name, idx) => {
                const isFuture = selectedYear === currentYear && idx > currentMonth;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isFuture}
                    onClick={() => setSelectedMonth(idx)}
                    className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium border ${
                      isFuture ? 'opacity-30 cursor-not-allowed' : ''
                    } ${
                      selectedMonth === idx
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
            {/* Week rows */}
            <div className="overflow-y-auto flex-1">
              {weeks.map((week) => {
                const isFuture = week.from > timeBaseToRange('week', 0).from;
                return (
                  <button
                    key={week.from}
                    type="button"
                    disabled={isFuture}
                    onClick={() => handleWeekTap(week.from)}
                    className={`w-full text-left px-6 py-3 text-sm border-b border-gray-50 dark:border-gray-800 ${
                      isFuture
                        ? 'opacity-30 cursor-not-allowed text-gray-400'
                        : 'text-gray-800 dark:text-gray-200'
                    }`}
                  >
                    {week.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
