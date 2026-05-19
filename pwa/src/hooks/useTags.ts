import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => apiFetch<{ tags: string[] }>('/pwa/tags').then((r) => r.tags),
    staleTime: 5 * 60_000,
  });
}
