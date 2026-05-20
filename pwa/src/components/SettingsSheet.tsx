import { BottomSheet } from './BottomSheet';
import { useSettings } from '../context/SettingsContext';
import type { Theme, Lang } from '../context/SettingsContext';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsSheet({ open, onClose }: Props) {
  const { theme, lang, setTheme, setLang } = useSettings();

  const btnBase = 'flex-1 py-2 rounded-lg text-sm font-medium border transition-colors';
  const btnActive = 'bg-blue-600 text-white border-blue-600';
  const btnInactive = 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600';

  return (
    <BottomSheet open={open} onClose={onClose} title="設定 / Settings">
      <div className="px-4 py-4 space-y-6">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            語系 / Language
          </p>
          <div className="flex gap-2">
            {(['zh', 'en'] as Lang[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLang(l)}
                className={`${btnBase} ${lang === l ? btnActive : btnInactive}`}
              >
                {l === 'zh' ? '中文' : 'English'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            主題 / Theme
          </p>
          <div className="flex gap-2">
            {(['light', 'dark'] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`${btnBase} ${theme === t ? btnActive : btnInactive}`}
              >
                {t === 'light' ? '☀️ 淺色' : '🌙 深色'}
              </button>
            ))}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
