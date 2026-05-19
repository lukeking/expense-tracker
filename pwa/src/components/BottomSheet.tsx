import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: Props) {
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
        className="relative bg-white rounded-t-2xl max-h-[80dvh] flex flex-col"
        style={{ transform: 'translateY(0)', transition: 'transform 0.25s ease-out' }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          {title && <span className="font-semibold text-gray-900">{title}</span>}
          <button
            onClick={onClose}
            className="ml-auto text-gray-500 text-xl leading-none p-1"
            aria-label="關閉"
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
