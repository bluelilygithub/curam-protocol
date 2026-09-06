// Shared target-language list for the Translate agent — used by TranslatePage (job history
// labels) and SettingsPage (the single target-language setting, chosen once for the workspace
// rather than per job — see docs/translate-agent.md).
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'mi', label: 'te reo Māori' },
  { code: 'ga', label: 'Irish (Gaelic)' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ko', label: 'Korean' },
  { code: 'ru', label: 'Russian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'sv', label: 'Swedish' },
];
