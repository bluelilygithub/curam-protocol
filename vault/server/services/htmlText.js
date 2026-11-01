'use strict';

// YouTube's Data API sends titles and channel names HTML-escaped ("&quot;Dublin&quot; &amp; more", "It&#39;s"). They are plain text in Vault, shown by React (which
// escapes for itself), so they are decoded once, here, before they are shown, saved or put in a note. Tested in htmlText.test.js.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

/** "&quot;Hi&quot; &amp; &#39;bye&#39; &#x2019;" -> "\"Hi\" & 'bye' ’". Unknown entities are left as they are. Decoded once only ("&amp;quot;" -> "&quot;"). */
function decodeHtml(value) {
  return String(value == null ? '' : value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/** The rows with the named text fields decoded (a copy; other fields untouched). */
function decodeFields(rows, fields) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const out = { ...r };
    for (const f of fields) if (typeof out[f] === 'string') out[f] = decodeHtml(out[f]);
    return out;
  });
}

module.exports = { decodeHtml, decodeFields };
