'use strict';

/**
 * Google Cloud Translation API v2 helpers for the Translate agent.
 */

const fetch = require('node-fetch');

function getGoogleTranslateApiKey() {
  return String(process.env.GOOGLE_TRANSLATE_API_KEY || '').trim();
}

function isGoogleTranslateConfigured() {
  return Boolean(getGoogleTranslateApiKey());
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&[a-z]+;/gi, '');
}

function applyTypography(text, lang) {
  let t = decodeHtmlEntities(text);
  if (lang === 'fr' || lang === 'fr-CA') {
    t = t.replace(/"([^"]{1,200})"/g, '\u00AB\u00A0$1\u00A0\u00BB');
    t = t.replace(/\s*([;:!?])/g, '\u00A0$1');
    t = t.replace(/(\d)\s*\$\s*/g, '$1\u00A0$\u00A0');
  }
  return t;
}

/** Map Vault language codes to Google Translate v2 codes. */
function toGoogleLang(code) {
  const c = String(code || '').toLowerCase();
  if (c === 'zh-cn' || c === 'zh') return 'zh-CN';
  if (c === 'mi' || c === 'mao' || c === 'mri') return 'mi';
  return code;
}

async function detectLanguage(sampleText) {
  const key = getGoogleTranslateApiKey();
  if (!key) throw new Error('GOOGLE_TRANSLATE_API_KEY not configured');
  const detectRes = await fetch(
    `https://translation.googleapis.com/language/translate/v2/detect?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: String(sampleText || '').slice(0, 500) }),
    }
  );
  const detectData = await detectRes.json();
  if (!detectRes.ok) {
    throw new Error(detectData?.error?.message || `Google detect failed (${detectRes.status})`);
  }
  return detectData.data?.detections?.[0]?.[0]?.language || 'auto';
}

/**
 * Translate an array of strings. Returns same-length array of translated strings.
 * Uses HTML format so <span translate="no">…</span> can protect glossary DNT terms.
 */
async function translateTexts({ texts, targetLanguage, sourceLanguage = 'auto' }) {
  const key = getGoogleTranslateApiKey();
  if (!key) throw new Error('GOOGLE_TRANSLATE_API_KEY not configured');
  if (!texts?.length) return [];

  const body = {
    q: texts,
    target: toGoogleLang(targetLanguage),
    format: 'html',
  };
  if (sourceLanguage && sourceLanguage !== 'auto') {
    body.source = toGoogleLang(sourceLanguage);
  }

  const tRes = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  const tData = await tRes.json();
  if (!tRes.ok) {
    throw new Error(tData?.error?.message || `Google Translate failed (${tRes.status})`);
  }
  const translations = tData.data?.translations || [];
  return texts.map((_, i) => {
    const raw = translations[i]?.translatedText ?? '';
    return applyTypography(raw, targetLanguage);
  });
}

function wrapDoNotTranslate(text, terms) {
  let t = String(text || '');
  const dnt = (terms || []).filter((x) => x.doNotTranslate && x.source);
  // Longer first
  dnt.sort((a, b) => String(b.source).length - String(a.source).length);
  for (const term of dnt) {
    const escaped = String(term.source).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(escaped, 'gi'), `<span translate="no">${term.source}</span>`);
  }
  return t;
}

function stripDoNotTranslateSpans(text) {
  return String(text || '').replace(/<span translate="no">(.*?)<\/span>/gi, '$1');
}

module.exports = {
  getGoogleTranslateApiKey,
  isGoogleTranslateConfigured,
  detectLanguage,
  translateTexts,
  wrapDoNotTranslate,
  stripDoNotTranslateSpans,
  applyTypography,
  decodeHtmlEntities,
  toGoogleLang,
};
