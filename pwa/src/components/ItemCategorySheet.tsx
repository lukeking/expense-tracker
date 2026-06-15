import { useState } from 'react';
import { BottomSheet } from './BottomSheet';
import { useCategories, useMajors, useSubcategories } from '../hooks/useCategories';
import { EXPLICIT_UNCATEGORIZED } from '../lib/itemCategory';
import { useT } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  value: string | null;          // current item category tag (may be the sentinel), or null (inherit)
  inheritedTag: string | null;   // the transaction's category, shown on the inherit option
  extraTags?: string[];          // off-catalog category tags already present (FR-005)
  onSelect: (tag: string | null) => void; // null = inherit; EXPLICIT_UNCATEGORIZED = deliberate 'Other'
}

// Feature 026 (US1): a searchable + major-filterable category picker for a single item.
// Replaces ItemRow's flat, ungrouped list. Shared by ItemRow, the import review, and the
// Summary list so there is one item-categorization UI.
export function ItemCategorySheet({ open, onClose, value, inheritedTag, extraTags = [], onSelect }: Props) {
  const t = useT();
  const { data: categories } = useCategories();
  const majors = useMajors(categories);
  const [search, setSearch] = useState('');
  const [activeMajor, setActiveMajor] = useState<string | null>(null);
  const subsOfActive = useSubcategories(categories, activeMajor);

  // Preserve the legacy option set (majors + major:sub + already-present off-catalog tags),
  // now searchable/groupable rather than dumped as one flat list.
  const allOptions = [
    ...majors,
    ...((categories ?? []).filter((c) => c.subcategory !== null).map((c) => `${c.major}:${c.subcategory}`)),
    // The sentinel is selectable only via its dedicated action row, never as a chip.
    ...extraTags.filter((t) => t.includes(':') && t !== EXPLICIT_UNCATEGORIZED),
  ];
  const uniqueOptions = [...new Set(allOptions)];

  const q = search.trim().toLowerCase();
  const results = q ? uniqueOptions.filter((t) => t.toLowerCase().includes(q)) : [];

  function pick(tag: string | null) {
    onSelect(tag);
    setSearch('');
    setActiveMajor(null);
    onClose();
  }
  function handleClose() {
    setSearch('');
    setActiveMajor(null);
    onClose();
  }

  const rowCls = (active: boolean) =>
    `w-full text-left px-3 py-2 rounded text-sm ${
      active
        ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
    }`;
  const chipCls = (active: boolean) =>
    `flex-shrink-0 px-3 py-1.5 rounded-full text-sm border ${
      active
        ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-400'
        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
    }`;

  return (
    <BottomSheet open={open} onClose={handleClose} title={t('itemCat.title')}>
      <div className="px-4 py-3 space-y-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('itemCat.searchCategory')}
          className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
        />

        {/* Feature 027 (FR-014, approved mockup): two distinct, mutually reversible
            actions replace the old single ✕ row — inherit (live, follows the tx) and
            explicitly-uncategorized (deliberate 'Other' via the sentinel). */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => pick(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm border ${
              value === null
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <span className="text-base leading-none">↩</span>
            <span>{inheritedTag ? t('itemCat.inheritMajor', { tag: inheritedTag }) : t('itemCat.noCategory')}</span>
          </button>
          <button
            type="button"
            onClick={() => pick(EXPLICIT_UNCATEGORIZED)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm border ${
              value === EXPLICIT_UNCATEGORIZED
                ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                : 'text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <span className="text-base leading-none">⊘</span>
            <span>{t('itemCat.setOther')}</span>
          </button>
        </div>

        {q ? (
          <div className="space-y-1">
            {results.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500 px-1">{t('itemCat.noMatch')}</p>
            ) : (
              results.map((tag) => (
                <button key={tag} type="button" onClick={() => pick(tag)} className={rowCls(value === tag)}>
                  {tag}
                </button>
              ))
            )}
          </div>
        ) : (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {majors.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setActiveMajor(activeMajor === m ? null : m)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium border ${
                    activeMajor === m
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            {activeMajor && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => pick(activeMajor)} className={chipCls(value === activeMajor)}>
                  {t('itemCat.wholeMajor', { major: activeMajor })}
                </button>
                {subsOfActive.map((sub) => {
                  const tag = `${activeMajor}:${sub}`;
                  return (
                    <button key={tag} type="button" onClick={() => pick(tag)} className={chipCls(value === tag)}>
                      {sub}
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </BottomSheet>
  );
}
