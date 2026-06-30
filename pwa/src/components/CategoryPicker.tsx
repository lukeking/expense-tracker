import { useState } from 'react';
import { useCategories, useMajors, useSubcategories } from '../hooks/useCategories';
import { useCategoryUsage } from '../hooks/useCategoryUsage';
import { BottomSheet } from './BottomSheet';
import { useT } from '../i18n';

export interface CategorySelection {
  major: string;
  subcategory: string | null;
}

interface Props {
  value: CategorySelection | null;
  onChange: (value: CategorySelection | null) => void;
}

const MAX_VISIBLE_SUBCATEGORIES = 5;
// Always-visible major chips before the 「更多」 opener. Tuned to fit one mobile row at
// 390px alongside the 更多 chip (emoji-prefixed single-character names are narrow).
const MAX_VISIBLE_MAJORS = 4;

// PWA-only presentation: the DB stores the major NAME (食…) unchanged; this just renders an
// icon beside it. The major set is DB-managed and can grow, so unmapped majors render with no
// icon (graceful fallback — never breaks). Edit freely; it's pure presentation.
const MAJOR_ICONS: Record<string, string> = {
  食: '🍜', 衣: '👕', 住: '🏠', 行: '🚗', 育: '📚', 樂: '🎮', 醫: '🏥', 其他: '📦', 保險: '🛡️', // i18n-allow (keyed by DB major names)
};

function majorLabel(major: string): string {
  return MAJOR_ICONS[major] ? `${MAJOR_ICONS[major]} ${major}` : major;
}

export function CategoryPicker({ value, onChange }: Props) {
  const t = useT();
  const { data: categories } = useCategories();
  const majors = useMajors(categories);
  const usage = useCategoryUsage();
  const subcategories = useSubcategories(categories, value?.major ?? null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSearch, setSheetSearch] = useState('');
  const [majorSheetOpen, setMajorSheetOpen] = useState(false);

  // Frequency-ordered majors (fall back to natural DB order when no usage data).
  const orderedMajors = usage.hasData
    ? usage.majorRank.filter((m) => majors.includes(m))
    : majors;

  // Always-visible top-N, but guarantee the currently-selected major stays visible.
  let visibleMajors = orderedMajors.slice(0, MAX_VISIBLE_MAJORS);
  if (value?.major && !visibleMajors.includes(value.major)) {
    visibleMajors = [...orderedMajors.slice(0, MAX_VISIBLE_MAJORS - 1), value.major];
  }
  const hasMajorOverflow = orderedMajors.some((m) => !visibleMajors.includes(m));

  // Frequency-ordered subcategories for the selected major (fall back to natural order).
  const orderedSubs = (
    value?.major && usage.hasData ? usage.subRank.get(value.major) ?? subcategories : subcategories
  ).filter((s) => subcategories.includes(s));
  const visibleSubs = orderedSubs.slice(0, MAX_VISIBLE_SUBCATEGORIES);
  const hasOverflow = orderedSubs.length > MAX_VISIBLE_SUBCATEGORIES;

  function selectMajor(major: string) {
    if (value?.major === major) {
      onChange(null);
    } else {
      onChange({ major, subcategory: null });
    }
  }

  function selectSubcategory(sub: string) {
    if (!value) return;
    if (value.subcategory === sub) {
      onChange({ major: value.major, subcategory: null });
    } else {
      onChange({ major: value.major, subcategory: sub });
    }
    setSheetOpen(false);
  }

  const filteredSubs = orderedSubs.filter((s) =>
    s.toLowerCase().includes(sheetSearch.toLowerCase())
  );

  return (
    <div className="space-y-2">
      {/* Major chips: frequency-ranked top-N + more-opener (no horizontal scroll) */}
      <div className="flex flex-wrap gap-2">
        {visibleMajors.map((major) => (
          <button
            key={major}
            type="button"
            onClick={() => selectMajor(major)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              value?.major === major
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
            }`}
          >
            {majorLabel(major)}
          </button>
        ))}
        {hasMajorOverflow && (
          <button
            type="button"
            onClick={() => setMajorSheetOpen(true)}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600"
          >
            ⋯ {t('category.more')}
          </button>
        )}
      </div>

      {/* Subcategory chips */}
      {value?.major && orderedSubs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {visibleSubs.map((sub) => (
            <button
              key={sub}
              type="button"
              onClick={() => selectSubcategory(sub)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                value.subcategory === sub
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-400'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
              }`}
            >
              {sub}
            </button>
          ))}
          {hasOverflow && (
            <button
              type="button"
              onClick={() => { setSheetSearch(''); setSheetOpen(true); }}
              className="flex-shrink-0 px-3 py-1.5 rounded-full text-sm border bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600"
            >
              ···
            </button>
          )}
        </div>
      )}

      {/* Major overflow bottom sheet (all majors) */}
      <BottomSheet
        open={majorSheetOpen}
        onClose={() => setMajorSheetOpen(false)}
        title={t('category.allMajorsTitle')}
      >
        <div className="px-4 py-3 flex flex-wrap gap-2">
          {orderedMajors.map((major) => (
            <button
              key={major}
              type="button"
              onClick={() => { selectMajor(major); setMajorSheetOpen(false); }}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                value?.major === major
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
              }`}
            >
              {majorLabel(major)}
            </button>
          ))}
        </div>
      </BottomSheet>

      {/* Subcategory overflow bottom sheet */}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t('category.allSubsTitle', { major: value?.major ?? '' })}
      >
        <div className="px-4 py-3">
          <input
            type="search"
            value={sheetSearch}
            onChange={(e) => setSheetSearch(e.target.value)}
            placeholder={t('category.searchSubs')}
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm mb-3 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <div className="flex flex-wrap gap-2">
            {filteredSubs.map((sub) => (
              <button
                key={sub}
                type="button"
                onClick={() => selectSubcategory(sub)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  value?.subcategory === sub
                    ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-400'
                    : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
                }`}
              >
                {sub}
              </button>
            ))}
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
