// PDF font-selection logic for the Translate agent — split out of TranslatePage.jsx so it can
// be unit-tested with plain `node` (no JSX/bundler needed), same convention as
// translateLlmService.test.js. See docs/translate-agent.md "Fonts" section for the two real
// incidents this module exists to prevent from recurring.

'use strict';

// Helvetica (react-pdf's built-in default) only covers WinAnsi/Latin-1 — no macrons, no Polish
// diacritics. Confirmed on a real te reo Māori job: every macron vowel (ā ē ī ō ū) rendered as
// garbage (missing-glyph substitution), producing mojibake across the whole translated PDF
// ("TM Mahere" instead of "Tā Mahere", etc.) — invisible in the QA report because the text
// content itself was correct, only the rendered glyph was wrong. NotoSans-Regular covers Latin
// Extended-A/B, so 'mi' and 'pl' (ą ę ł ń ś ź ż, also outside Latin-1) route through it too.
const FONT_BY_LANG = {
  'zh-CN': '/fonts/NotoSansSC.ttf',
  ja: '/fonts/NotoSansJP.ttf',
  ar: '/fonts/NotoSansArabic.ttf',
  ko: '/fonts/NotoSansJP.ttf', // fallback
  mi: '/fonts/NotoSans-Regular.ttf',
  pl: '/fonts/NotoSans-Regular.ttf',
};

// The PDF always shows BOTH source and translated text (side-by-side / bilingual-pages layouts
// render the original alongside the translation), so font choice must cover whichever of
// source/target needs non-Latin1 glyphs — not just the target. Confirmed on a real mi → en job:
// source language (te reo Māori) needed Noto but target (English) didn't, so checking target
// alone missed it, Helvetica rendered the page, and every macron in the ORIGINAL column
// silently vanished (WinAnsi encoding drops unmapped glyphs rather than showing a placeholder)
// — "Māori" → "Mori". Always check both directions: mi → en AND en → mi must both resolve to
// the Noto font, or this exact regression is back.
function pickPdfFontUrl(targetLanguage, sourceLanguage) {
  return FONT_BY_LANG[targetLanguage] || FONT_BY_LANG[sourceLanguage] || null;
}

function needsNotoFont(targetLanguage, sourceLanguage) {
  return Boolean(FONT_BY_LANG[targetLanguage]) || Boolean(FONT_BY_LANG[sourceLanguage]);
}

module.exports = { FONT_BY_LANG, pickPdfFontUrl, needsNotoFont };
