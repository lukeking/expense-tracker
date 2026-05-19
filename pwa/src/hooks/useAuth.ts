import { useState, useEffect } from 'react';
import { getApiKey, subscribeToAuthState } from '../api/client';

export function useApiKey() {
  const [apiKey, setApiKeyState] = useState<string | null>(getApiKey);

  useEffect(() => {
    const unsub = subscribeToAuthState(() => setApiKeyState(null));
    return () => { unsub(); };
  }, []);

  const refresh = () => setApiKeyState(getApiKey());

  return { apiKey, refresh };
}
