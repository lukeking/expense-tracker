import { useState } from 'react';
import { useCategories, useMajors, useSubcategories } from '../hooks/useCategories';
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

// PWA-only presentation: the DB stores the major NAME (食…) unchanged; this just renders an
// icon beside it. The major set is DB-managed and can grow, so unmapped majors render with no
// icon (graceful fallback — never breaks). Edit freely; it's pure presentation.
const MAJOR_ICONS: Record<string, string> = {
  食: '🍜', 衣: '👕', 住: '🏠', 行: '🚗', 育: '📚', 樂: '🎮', 醫: '🏥', 其他: '📦', 保險: '🛡️', // i18n-allow (keyed by DB major names)
};

export function CategoryPicker({ value, onChange }: Props) {
  const t = useT();
  const { data: categories } = useCategories();
  const majors = useMajors(categories);
  const subcategories = useSubcategories(categories, value?.major ?? null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetSearch, setSheetSearch] = useState('');

  const visibleSubs = subcategories.slice(0, MAX_VISIBLE_SUBCATEGORIES);
  const hasOverflow = subcategories.length > MAX_VISIBLE_SUBCATEGORIES;

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

  const filteredSubs = subcategories.filter((s) =>
    s.toLowerCase().includes(sheetSearch.toLowerCase())
  );

  return (
    <div className="space-y-2">
      {/* Major chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {majors.map((major) => (
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
            {MAJOR_ICONS[major] ? `${MAJOR_ICONS[major]} ${major}` : major}
          </button>
        ))}
      </div>

      {/* Subcategory chips */}
      {value?.major && subcategories.length > 0 && (
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

      {/* Overflow bottom sheet */}
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
