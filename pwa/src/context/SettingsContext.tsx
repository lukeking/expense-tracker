import { createContext, useContext, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
export type Lang = 'zh' | 'en';

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
  const [lang, setLangState] = useState<Lang>(
    () => (localStorage.getItem('lang') as Lang | null) ?? 'zh'
  );

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
