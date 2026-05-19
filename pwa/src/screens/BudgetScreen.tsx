import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

interface BudgetData {
  current_spend: number;
  monthly_budget: number;
  percentage: number;
}

export function BudgetScreen() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['budget'],
    queryFn: () => apiFetch<BudgetData>('/pwa/budget'),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="h-full flex items-center justify-center text-gray-400">載入中…</div>;
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center px-6">
        <p className="text-red-600 text-sm text-center">無法載入預算資料</p>
      </div>
    );
  }

  const pct = Math.min(data.percentage, 100);
  const overBudget = data.current_spend > data.monthly_budget;

  return (
    <div className="flex flex-col h-full p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">本月預算</h2>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-2">
          <span>NT${data.current_spend.toLocaleString()} 已使用</span>
          <span>NT${data.monthly_budget.toLocaleString()}</span>
        </div>
        <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${overBudget ? 'bg-red-500' : 'bg-blue-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Percentage label */}
      <div className={`text-center py-4 ${overBudget ? 'text-red-600' : 'text-gray-700'}`}>
        <span className="text-4xl font-bold">{data.percentage}%</span>
        {overBudget && <p className="text-sm mt-2 font-medium">已超出預算</p>}
      </div>

      {/* Remaining */}
      {!overBudget && (
        <p className="text-center text-sm text-gray-500">
          尚餘 NT${(data.monthly_budget - data.current_spend).toLocaleString()}
        </p>
      )}
    </div>
  );
}
