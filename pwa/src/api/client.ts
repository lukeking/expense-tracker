import { QueryClient } from '@tanstack/react-query';

const KEY = 'expense_api_key';

export function getApiKey() { return localStorage.getItem(KEY); }
export function setApiKey(key: string) { localStorage.setItem(KEY, key); }
export function clearApiKey() { localStorage.removeItem(KEY); }

const authListeners = new Set<() => void>();
export function subscribeToAuthState(fn: () => void) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}

export class AuthError extends Error {
  constructor() { super('Unauthorized'); this.name = 'AuthError'; }
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const base = import.meta.env.VITE_API_BASE ?? '';
  const key = getApiKey();
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    clearApiKey();
    authListeners.forEach((fn) => fn());
    throw new AuthError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string };
    throw new ApiError(body.error ?? 'UNKNOWN', body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});
