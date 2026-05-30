const PM_LABELS: Record<string, string> = {
  credit_card: '信用卡',
  cash: '現金',
  prepaid_wallet: '儲值卡',
  easy_card: '悠遊卡',
  bank_account: '銀行帳戶',
};

interface FilterBarProps {
  tags: string[];
  paymentMethods: string[];
  activeTag: string | null;
  activePayment: string | null;
  onTagChange: (tag: string | null) => void;
  onPaymentChange: (pm: string | null) => void;
}

export function FilterBar({ tags, paymentMethods, activeTag, activePayment, onTagChange, onPaymentChange }: FilterBarProps) {
  if (tags.length === 0 && paymentMethods.length === 0) return null;

  return (
    <div className="px-4 pb-2 space-y-1.5">
      {tags.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTagChange(activeTag === t ? null : t)}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                activeTag === t
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
              }`}
            >
              #{t}
            </button>
          ))}
        </div>
      )}
      {paymentMethods.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {paymentMethods.map((pm) => (
            <button
              key={pm}
              type="button"
              onClick={() => onPaymentChange(activePayment === pm ? null : pm)}
              className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                activePayment === pm
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600'
              }`}
            >
              {PM_LABELS[pm] ?? pm}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
