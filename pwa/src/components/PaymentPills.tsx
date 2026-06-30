import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

export type PaymentMethod = 'cash' | 'credit_card' | 'easy_card' | 'prepaid_wallet' | 'bank_account';

export const LABEL_KEYS: Record<PaymentMethod, MessageKey> = {
  cash: 'payment.cash',
  credit_card: 'payment.creditCard',
  easy_card: 'payment.easyCard',
  prepaid_wallet: 'payment.prepaidWallet',
  bank_account: 'payment.bankAccount',
};

const METHODS: PaymentMethod[] = ['cash', 'credit_card', 'easy_card', 'prepaid_wallet', 'bank_account'];

interface Props {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}

export function PaymentPills({ value, onChange }: Props) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-2">
      {METHODS.map((method) => (
        <button
          key={method}
          type="button"
          onClick={() => onChange(method)}
          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            value === method
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-gray-600'
          }`}
        >
          {t(LABEL_KEYS[method])}
        </button>
      ))}
    </div>
  );
}
