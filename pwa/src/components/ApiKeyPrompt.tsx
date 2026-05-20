import { useState } from 'react';
import { setApiKey, apiFetch, AuthError } from '../api/client';

interface Props {
  onSuccess: () => void;
}

export function ApiKeyPrompt({ onSuccess }: Props) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError('');
    setApiKey(key.trim());
    try {
      await apiFetch('/pwa/categories');
      onSuccess();
    } catch (err) {
      if (err instanceof AuthError) {
        setError('API key 不正確，請重試');
      } else {
        setError('連線失敗，請確認網路後重試');
      }
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full bg-gray-50 dark:bg-gray-900 px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Expense Tracker</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-8">請輸入 API key 以繼續</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="API key"
            autoComplete="current-password"
            className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="w-full bg-blue-600 text-white rounded-lg py-3 font-semibold disabled:opacity-50"
          >
            {loading ? '驗證中…' : '登入'}
          </button>
        </form>
      </div>
    </div>
  );
}
