import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type Lang = 'zh' | 'en';

// The supported display languages. `zh` ≡ Traditional Chinese (zh-TW); `en` ≡ English.
export const SUPPORTED_LANGS: Lang[] = ['zh', 'en'];

// Resolve the startup language: a valid stored choice, else default to zh (FR-005).
// An absent or unrecognized stored value falls back to zh — no browser auto-detection.
function resolveStoredLang(): Lang {
  const stored = localStorage.getItem('lang');
  return stored !== null && (SUPPORTED_LANGS as string[]).includes(stored) ? (stored as Lang) : 'zh';
}

interface Settings {
  theme: Theme;
  lang: Lang;
  setTheme: (t: Theme) => void;
  setLang: (l: Lang) => void;
}

const Ctx = createContext<Settings>({
  theme: 'light',
  lang: 'zh',
  setTheme: () => {},
  setLang: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem('theme') as Theme | null) ?? 'light'
  );
  const [lang, setLangState] = useState<Lang>(resolveStoredLang);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
    localStorage.setItem('theme', t);
  }

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem('lang', l);
  }

  return <Ctx.Provider value={{ theme, lang, setTheme, setLang }}>{children}</Ctx.Provider>;
}

export function useSettings() {
  return useContext(Ctx);
}
