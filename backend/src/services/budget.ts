import type { SupabaseClient } from '@supabase/supabase-js';
import type { BudgetProgress } from '../types';
import { getMonthlySpend, getBudgetSettings } from '../db/queries';

export async function getBudgetProgress(
  supabase: SupabaseClient,
  year?: number,
  month?: number
): Promise<BudgetProgress> {
  const now = new Date();
  const y = year ?? now.getUTCFullYear();
  const m = month ?? now.getUTCMonth() + 1;

  const [currentSpend, budgetSettings] = await Promise.all([
    getMonthlySpend(supabase, y, m),
    getBudgetSettings(supabase),
  ]);

  const percentage = Math.round((currentSpend / budgetSettings.monthly_budget) * 100);

  return {
    current_spend: currentSpend,
    monthly_budget: budgetSettings.monthly_budget,
    percentage,
    year: y,
    month: m,
  };
}
