import type { Messages } from './zh';

// English catalog. Typed as Messages → a missing or renamed key is a compile error (SC-002).
export const en: Messages = {
  'common.loading': 'Loading…',

  'nav.entry': 'Entry',
  'nav.summary': 'Summary',
  'nav.budget': 'Budget',
  'nav.import': 'Import',
  'nav.settings': 'Settings',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.themeLight': '☀️ Light',
  'settings.themeDark': '🌙 Dark',
  'settings.langZh': '中文',
  'settings.langEn': 'English',
};
