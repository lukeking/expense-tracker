export type PaymentMethod = 'cash' | 'credit_card' | 'easy_card' | 'prepaid_wallet' | 'bank_account';

const LABELS: Record<PaymentMethod, string> = {
  cash: '現金',
  credit_card: '信用卡',
  easy_card: '悠遊卡',
  prepaid_wallet: '電子支付',
  bank_account: '銀行帳戶',
};

const METHODS: PaymentMethod[] = ['cash', 'credit_card', 'easy_card', 'prepaid_wallet', 'bank_account'];

interface Props {
  value: PaymentMethod;
  onChange: (method: PaymentMethod) => void;
}

export function PaymentPills({ value, onChange }: Props) {
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
              : 'bg-white text-gray-700 border-gray-300'
          }`}
        >
          {LABELS[method]}
        </button>
      ))}
    </div>
  );
}
