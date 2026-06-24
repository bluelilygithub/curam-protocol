'use strict';

function normalizeUrl(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function normalizeUrlList(urls = [], max = 3) {
  return [...new Set((urls || []).map(normalizeUrl).filter(Boolean))].slice(0, max);
}

module.exports = {
  normalizeUrl,
  normalizeUrlList,
};
