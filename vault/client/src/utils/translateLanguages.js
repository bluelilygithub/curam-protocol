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
  { code: 'af', label: 'Afrikaans' },
];

/**
 * Apply an admin-chosen display order (array of language codes, from the
 * `translate_language_order` setting) to LANGUAGES. Codes not in `order` keep their default
 * position, appended after the ordered ones — so adding a new language never requires an
 * admin to update the order first for it to still appear.
 */
export function orderLanguages(order) {
  if (!Array.isArray(order) || !order.length) return LANGUAGES;
  const byCode = new Map(LANGUAGES.map((l) => [l.code, l]));
  const ordered = order.map((c) => byCode.get(c)).filter(Boolean);
  const seen = new Set(ordered.map((l) => l.code));
  const remaining = LANGUAGES.filter((l) => !seen.has(l.code));
  return [...ordered, ...remaining];
}
