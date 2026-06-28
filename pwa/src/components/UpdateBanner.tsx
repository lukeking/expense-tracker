import { useRegisterSW } from 'virtual:pwa-register/react';
import { useT } from '../i18n';

// Surfaces a waiting service-worker update as a manual, non-blocking notice.
// Tapping 更新 activates the new SW and reloads; ignoring it leaves typing untouched
// (the new SW activates on the next app open). See vite.config.ts for why we use
// 'prompt' instead of silent auto-reload.
//
// Rendered as an in-flow top bar (see App.tsx <Layout>), not a floating overlay:
// the Entry screen fills the full height with the amount input pinned at top and
// the submit button pinned at bottom, so any overlay would cover a control. As a
// bar it takes its own space and pushes content down, covering nothing.
export function UpdateBanner() {
  const t = useT();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({ immediate: true });

  if (!needRefresh) return null;

  return (
    <div className="flex items-center gap-3 bg-gray-900 dark:bg-gray-700 text-white px-4 py-2 text-sm">
      <span className="flex-1">{t('update.available')}</span>
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
  );
}
