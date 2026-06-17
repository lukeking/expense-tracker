import { BottomSheet } from './BottomSheet';
import { useSettings } from '../context/SettingsContext';
import type { Theme, Lang } from '../context/SettingsContext';
import { useT } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsSheet({ open, onClose }: Props) {
  const { theme, lang, setTheme, setLang } = useSettings();
  const t = useT();

  const btnBase = 'flex-1 py-2 rounded-lg text-sm font-medium border transition-colors';
  const btnActive = 'bg-blue-600 text-white border-blue-600';
  const btnInactive = 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600';

  return (
    <BottomSheet open={open} onClose={onClose} title={t('settings.title')}>
      <div className="px-4 py-4 space-y-6">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {t('settings.language')}
          </p>
          <div className="flex gap-2">
            {(['zh', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`${btnBase} ${lang === l ? btnActive : btnInactive}`}
              >
                {l === 'zh' ? t('settings.langZh') : t('settings.langEn')}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            {t('settings.theme')}
          </p>
          <div className="flex gap-2">
            {(['light', 'dark'] as Theme[]).map((th) => (
              <button
                key={th}
                type="button"
                onClick={() => setTheme(th)}
                className={`${btnBase} ${theme === th ? btnActive : btnInactive}`}
              >
                {th === 'light' ? t('settings.themeLight') : t('settings.themeDark')}
              </button>
            ))}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
