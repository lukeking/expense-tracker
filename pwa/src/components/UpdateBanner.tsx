import { useRegisterSW } from 'virtual:pwa-register/react';
import { useT } from '../i18n';

// Surfaces a waiting service-worker update as a manual, non-blocking banner.
// Tapping 更新 activates the new SW and reloads; ignoring it leaves typing untouched
// (the new SW activates on the next app open). See vite.config.ts for why we use
// 'prompt' instead of silent auto-reload.
export function UpdateBanner() {
  const t = useT();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;

  return (
    // Wrapper is click-through; only the pill itself captures taps, so it never
    // blocks the form underneath while it sits there.
    <div className="fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-gray-900 dark:bg-gray-700 text-white shadow-lg pl-4 pr-2 py-2 text-sm">
        <span>{t('update.available')}</span>
        <button
          type="button"
          onClick={() => updateServiceWorker(true)}
          className="rounded-full bg-blue-600 px-3 py-1 font-semibold"
        >
          {t('update.action')}
        </button>
        <button
          type="button"
          onClick={() => setNeedRefresh(false)}
          aria-label={t('update.dismiss')}
          className="text-gray-300 hover:text-white px-1.5"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
