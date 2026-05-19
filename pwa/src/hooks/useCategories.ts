import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export interface CategoryRow {
  major: string;
  subcategory: string | null;
  sort_order: number;
}

interface CategoriesResponse {
  categories: CategoryRow[];
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<CategoriesResponse>('/pwa/categories').then((r) => r.categories),
    staleTime: 5 * 60_000,
  });
}

export function useMajors(categories: CategoryRow[] | undefined) {
  if (!categories) return [];
  return [...new Set(categories.map((c) => c.major))];
}

export function useSubcategories(categories: CategoryRow[] | undefined, major: string | null) {
  if (!categories || !major) return [];
  return categories
    .filter((c) => c.major === major && c.subcategory !== null)
    .map((c) => c.subcategory as string);
}
