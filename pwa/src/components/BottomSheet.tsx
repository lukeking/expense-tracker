import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: Props) {
  const t = useT();
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        ref={sheetRef}
        className="relative bg-white dark:bg-gray-800 rounded-t-2xl max-h-[80dvh] flex flex-col"
        style={{ transform: 'translateY(0)', transition: 'transform 0.25s ease-out' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          {title && <span className="font-semibold text-gray-900 dark:text-white">{title}</span>}
          <button
            onClick={onClose}
            className="ml-auto text-gray-500 dark:text-gray-400 text-xl leading-none p-1"
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
        <div className="overflow-y-auto flex-1 pb-safe">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
