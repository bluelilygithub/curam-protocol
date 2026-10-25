'use strict';

// Pulls the useful bits out of a sign-up email: verification codes and confirm/verify links. Pure code (no model), so it is
// predictable and testable. It never fetches a link; the person decides what to open.

const CODE_HINT = /(code|otp|pin|passcode|password|verification|verify|confirm|security|one[- ]time|token)/i;
const LINK_HINT = /(verify|confirm|activate|validate|magic|token=|signin|sign-in|login|auth|reset|click|continue|complete|welcome)/i;
const MAX_CODES = 5;
const MAX_LINKS = 8;

function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Codes of 4-8 digits (or 6-8 letters/digits written like G-123456 / ABC123) that sit near a word like "code" or "verification". */
function extractCodes(subject, text) {
  const body = `${subject || ''}\n${text || ''}`;
  const found = [];
  const seen = new Set();
  const add = (code, score) => {
    const c = String(code).trim();
    if (!c || seen.has(c)) return;
    // years, and long runs that are really phone numbers/ids, are not codes
    if (/^(19|20)\d\d$/.test(c)) return;
    seen.add(c);
    found.push({ code: c, score });
  };

  const lines = body.split('\n').filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const near = `${lines[i - 1] || ''} ${lines[i]} ${lines[i + 1] || ''}`;
    if (!CODE_HINT.test(near)) continue;
    for (const m of lines[i].matchAll(/(?<![\w.@/-])(\d{3}[ -]\d{3}|\d{4,8})(?![\w@/-]|\.\d)/g)) {
      add(m[1].replace(/[ -]/g, ''), CODE_HINT.test(lines[i]) ? 2 : 1);
    }
    for (const m of lines[i].matchAll(/(?<![\w.@/-])([A-Z0-9]{6,8})(?![\w@/-])/g)) {
      if (/\d/.test(m[1]) && /[A-Z]/.test(m[1])) add(m[1], 1);
    }
    // the code often sits alone on the next line
    if (i + 1 < lines.length && CODE_HINT.test(lines[i]) && /^\s*(\d{4,8}|\d{3}[ -]\d{3})\s*$/.test(lines[i + 1])) {
      add(lines[i + 1].replace(/[\s-]/g, ''), 3);
    }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, MAX_CODES).map((f) => f.code);
}

/** http(s) links, confirm-looking ones first. Tracking pixels and unsubscribe links are left out. */
function extractLinks(html, text) {
  const out = [];
  const seen = new Set();
  const add = (url, label) => {
    let u;
    try { u = new URL(String(url).trim().replace(/[)>.,;]+$/, '')); } catch { return; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
    const href = u.toString();
    if (seen.has(href) || href.length > 2000) return;
    if (/unsubscribe|optout|opt-out|preferences|\.(png|jpe?g|gif|svg|webp|css|js)(\?|$)|\/open\?|pixel|track\/open/i.test(href) && !LINK_HINT.test(label || '')) return;
    seen.add(href);
    const cleanLabel = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    out.push({ url: href, host: u.host, label: cleanLabel, likely: LINK_HINT.test(href) || LINK_HINT.test(cleanLabel) });
  };

  for (const m of String(html || '').matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    add(m[1].replace(/&amp;/g, '&'), stripHtml(m[2]));
  }
  for (const m of String(text || '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) add(m[0], '');

  return out.sort((a, b) => Number(b.likely) - Number(a.likely)).slice(0, MAX_LINKS);
}

module.exports = { extractCodes, extractLinks, stripHtml };
