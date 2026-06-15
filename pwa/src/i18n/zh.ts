// Traditional Chinese (zh ≡ zh-TW) — base catalog and single source of truth for the key set.
// Strings are the verbatim current UI wording; do not reword (FR-008).
// Keys are added per migration phase, grouped by area (common.* / nav.* / settings.* / entry.* …).
export const zh = {
  'common.loading': '載入中…',

  'nav.entry': '記帳',
  'nav.summary': '統計',
  'nav.budget': '預算',
  'nav.import': '匯入',
  'nav.settings': '設定',

  'settings.title': '設定',
  'settings.language': '語系',
  'settings.theme': '主題',
  'settings.themeLight': '☀️ 淺色',
  'settings.themeDark': '🌙 深色',
  'settings.langZh': '中文',
  'settings.langEn': 'English',
};

export type Messages = typeof zh;
export type MessageKey = keyof Messages;
