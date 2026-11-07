// Video Tools, Generate clip, YouTube example: how the page says who wrote the captions it is using. Pure, so
// `node client/src/pages/videos/captionsLabel.test.mjs` checks it. `captions` is { provenance: 'manual' | 'auto' | 'unknown', languageName, languageCode } or null.

/** The words added after "Transcript available for style matching", or '' when nothing is known. */
export function captionsLabel(captions) {
  if (!captions || typeof captions !== 'object') return '';
  const lang = String(captions.languageName || captions.languageCode || '').trim();
  const inLang = lang ? ` in ${lang}` : '';
  if (captions.provenance === 'manual') return ` (written by a person${inLang})`;
  if (captions.provenance === 'auto') return ` (made by YouTube's speech recognition${inLang}, so it may mishear names and numbers)`;
  return lang ? ` (${lang}; who wrote it is unknown)` : '';
}
