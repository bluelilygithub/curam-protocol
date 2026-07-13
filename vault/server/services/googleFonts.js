'use strict';

const fs = require('fs/promises');
const path = require('path');

const _cache = new Map();

function fontWeightNum(fontWeight = 'normal') {
  if (fontWeight === 'bold' || fontWeight === '700' || Number(fontWeight) >= 600) return 700;
  return 400;
}

async function fetchGoogleFontBytes(family, weight = 400) {
  const name = String(family || 'Roboto').trim();
  const key = `${name}::${weight}`;
  if (_cache.has(key)) return _cache.get(key);

  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@${weight}`;
  const cssResp = await fetch(cssUrl, {
    headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1)' },
  });
  if (!cssResp.ok) throw new Error(`Google Fonts CSS fetch failed: ${name} (${cssResp.status})`);

  const css = await cssResp.text();
  const urlMatch = css.match(/url\((https?:\/\/fonts\.gstatic\.com\/[^)]+\.ttf[^)]*)\)/i)
    || css.match(/url\((https?:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!urlMatch) throw new Error(`No TTF URL in Google Fonts CSS for: ${name}`);

  const fontResp = await fetch(urlMatch[1]);
  if (!fontResp.ok) throw new Error(`Font file fetch failed for: ${name}`);
  const bytes = Buffer.from(await fontResp.arrayBuffer());
  _cache.set(key, bytes);
  return bytes;
}

async function writeFontToDir(family, fontWeight, dir) {
  const weight = fontWeightNum(fontWeight);
  const bytes = await fetchGoogleFontBytes(family, weight);
  const safe = String(family || 'Roboto').replace(/[^\w-]+/g, '_');
  const filePath = path.join(dir, `${safe}-${weight}.ttf`);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

module.exports = {
  fetchGoogleFontBytes,
  writeFontToDir,
  fontWeightNum,
};
