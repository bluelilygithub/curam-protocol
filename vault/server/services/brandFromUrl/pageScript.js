'use strict';

// Runs INSIDE the page (Playwright serialises this function and calls it in the browser), so it must not use anything from this file or
// from Node. It reads what the browser really painted: computed colours, fonts and corner radii of the visible elements, weighted by how
// much of the page they cover, plus the places a logo is likely to be. It changes nothing except a data-brand-logo marker on logo
// candidates (so the server can screenshot one).
//
// Returns plain data only: { canvas, themeColor, title, siteName, bg, fg, btnBg, btnFg, linkFg, border, fonts, radii, logos, headIcons }.
// Colour maps are { '#rrggbb': weight }.

function collectBrand(opts) {
  const maxEls = (opts && opts.maxEls) || 5000;
  const vw = Math.max(window.innerWidth, 1);
  const vh = Math.max(window.innerHeight, 1);
  const viewArea = vw * vh;
  const NOISE = /cookie|consent|gdpr|popup|modal|newsletter|announce|promo|banner|toast|chat|intercom|drift|hubspot|livechat|notification/i;

  // Any CSS colour syntax (rgb, hsl, oklch, color(display-p3 ...)) -> [r, g, b, a], by painting one pixel.
  const cv = document.createElement('canvas');
  cv.width = 1; cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const colourCache = new Map();
  function rgba(css) {
    if (!css) return null;
    if (colourCache.has(css)) return colourCache.get(css);
    let out = null;
    try {
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = 'rgba(0,0,0,0)';
      cx.fillStyle = css;
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      out = [d[0], d[1], d[2], d[3]];
    } catch (e) { out = null; }
    colourCache.set(css, out);
    return out;
  }
  const hex2 = (n) => n.toString(16).padStart(2, '0');
  function hexOf(css, minAlpha) {
    const c = rgba(css);
    if (!c || c[3] < (minAlpha == null ? 128 : minAlpha)) return null;
    return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
  }
  const add = (map, key, w) => { if (key && w > 0) map[key] = (map[key] || 0) + w; };

  const out = {
    canvas: null, themeColor: null, title: document.title || '', siteName: '',
    bg: {}, fg: {}, btnBg: {}, btnFg: {}, linkFg: {}, border: {}, fonts: {}, radii: [], logos: [], headIcons: [],
  };

  const bodyBg = hexOf(getComputedStyle(document.body).backgroundColor);
  const htmlBg = hexOf(getComputedStyle(document.documentElement).backgroundColor);
  out.canvas = bodyBg || htmlBg || null;

  const meta = (sel, attr) => { const m = document.querySelector(sel); return m ? m.getAttribute(attr) : null; };
  out.themeColor = hexOf(meta('meta[name="theme-color"]', 'content'));
  out.siteName = meta('meta[property="og:site_name"]', 'content') || '';

  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'LINK', 'META', 'TEMPLATE', 'IFRAME', 'CANVAS', 'VIDEO', 'AUDIO']);
  const isButtonLike = (el) => {
    const t = el.tagName;
    if (t === 'BUTTON' || (t === 'INPUT' && /^(submit|button)$/i.test(el.type))) return true;
    if (el.getAttribute('role') === 'button') return true;
    return t === 'A' && /(^|[\s_-])(btn|button|cta)([\s_-]|$)/i.test(el.className && el.className.baseVal === undefined ? String(el.className) : '');
  };

  const all = document.body.querySelectorAll('*');
  const limit = Math.min(all.length, maxEls);
  for (let i = 0; i < limit; i += 1) {
    const el = all[i];
    if (SKIP.has(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.bottom < 0 || r.top > vh * 4) continue; // the first four screens: enough to see the brand, skips the far footer
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) continue;

    const hint = `${el.id || ''} ${typeof el.className === 'string' ? el.className : ''}`;
    const damp = NOISE.test(hint) ? 0.15 : 1; // cookie bars, sale banners, chat widgets: seen, but they must not decide the brand
    const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, vh * 4) - Math.max(r.top, 0));
    const areaFrac = (w * h) / viewArea;
    const button = isButtonLike(el);

    const bg = hexOf(cs.backgroundColor);
    if (bg) {
      add(out.bg, bg, areaFrac * damp);
      if (button) add(out.btnBg, bg, (1 + areaFrac * 10) * damp);
    }

    // text drawn directly in this element: characters, scaled by font size so a headline outweighs small print
    let chars = 0;
    for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3) chars += n.textContent.trim().length;
    if (chars > 0) {
      const size = parseFloat(cs.fontSize) || 16;
      const weight = chars * (size / 16) * (size / 16) * damp;
      const fg = hexOf(cs.color);
      add(out.fg, fg, weight);
      if (button) add(out.btnFg, fg, damp);
      else if (el.tagName === 'A') add(out.linkFg, fg, chars * damp);

      const family = String(cs.fontFamily || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
      if (family) {
        const heading = /^H[1-3]$/.test(el.tagName) || size >= 28;
        const wt = parseInt(cs.fontWeight, 10) || 400;
        const key = `${heading ? 'h' : 'b'}|${family}|${wt}`;
        out.fonts[key] = (out.fonts[key] || 0) + weight;
      }
    }

    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') add(out.border, hexOf(cs.borderTopColor), damp);

    // corner radius of things that are meant to look like buttons, fields or cards
    const roundable = button || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'
      || (bg && r.width >= 120 && r.width <= 640 && r.height >= 60 && r.height <= 500);
    if (roundable && out.radii.length < 400) {
      const raw = cs.borderTopLeftRadius || '0px';
      let px = null;
      if (raw.endsWith('px')) px = parseFloat(raw);
      else if (raw.endsWith('%')) px = 9999;
      // a radius at least half the shorter side is a pill or circle: recorded as 9999 so it counts as "fully round"
      if (px != null && !Number.isNaN(px)) out.radii.push(px >= Math.min(r.width, r.height) / 2 ? 9999 : px);
    }
  }

  // ---- logo candidates: images and inline SVGs near the top of the page, scored by how logo-like they are ----
  const ICONISH = /icon|avatar|flag|social|arrow|chevron|search|cart|menu|close|hamburger|facebook|twitter|instagram|linkedin|youtube|tiktok|pinterest|whatsapp/i;
  const cands = [];
  document.querySelectorAll('img, svg, [class*="logo" i], [id*="logo" i]').forEach((el) => {
    if (el.closest('svg') && el.tagName !== 'svg' && el.closest('svg') !== el) return; // a shape inside an svg is not a candidate
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.top > 320 || r.bottom < 0 || r.left > vw * 0.92) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return;
    const tag = el.tagName.toLowerCase();
    let kind = tag === 'img' ? 'img' : tag === 'svg' ? 'svg' : null;
    let src = '';
    if (kind === 'img') src = el.currentSrc || el.src || '';
    if (!kind) {
      const m = /url\(["']?([^"')]+)["']?\)/.exec(cs.backgroundImage || '');
      if (!m) return;
      kind = 'bg';
      try { src = new URL(m[1], location.href).toString(); } catch (e) { return; }
    }
    const cls = typeof el.className === 'string' ? el.className : (el.className && el.className.baseVal) || '';
    const hint = `${cls} ${el.id || ''} ${el.getAttribute('alt') || ''} ${el.getAttribute('aria-label') || ''} ${src}`.toLowerCase();
    let score = 0;
    if (/logo|brand|wordmark|logotype/.test(hint)) score += 4;
    const a = el.closest('a');
    if (a) {
      try { const u = new URL(a.href); if (u.origin === location.origin && (u.pathname === '/' || u.pathname === '')) score += 4; } catch (e) { /* not a link */ }
    }
    if (el.closest('header, [role="banner"], nav')) score += 2;
    if (r.top < 140) score += 2;
    if (r.left < vw * 0.35) score += 1.5;
    if (r.width < 24 || r.height < 12) score -= 6;
    if (r.width > 520 || r.height > 220) score -= 4;
    if (el.closest('li') && !/logo|brand/.test(hint)) score -= 3;
    if (NOISE.test(hint)) score -= 8;
    if (ICONISH.test(hint) && !/logo/.test(hint)) score -= 4;
    if (score < 2) return;
    cands.push({ el, kind, src, score, w: Math.round(r.width), h: Math.round(r.height), alt: el.getAttribute('alt') || '' });
  });
  cands.sort((x, y) => y.score - x.score);
  const seen = new Set();
  let marker = 0;
  for (const c of cands) {
    const k = c.src || `svg${marker}`;
    if (seen.has(k) || out.logos.length >= 5) continue;
    seen.add(k);
    c.el.setAttribute('data-brand-logo', String(marker));
    out.logos.push({ marker, kind: c.kind, src: c.src, score: c.score, width: c.w, height: c.h, alt: c.alt });
    marker += 1;
  }

  // ---- icons named in the page head: fall-backs when no logo is found on the page ----
  const abs = (u) => { try { return new URL(u, location.href).toString(); } catch (e) { return null; } };
  document.querySelectorAll('link[rel~="apple-touch-icon"], link[rel~="icon"]').forEach((l) => {
    const url = abs(l.getAttribute('href'));
    if (url) out.headIcons.push({ kind: /apple/.test(l.rel) ? 'apple-touch-icon' : 'icon', url, sizes: l.getAttribute('sizes') || '' });
  });
  const og = abs(meta('meta[property="og:image"]', 'content'));
  if (og) out.headIcons.push({ kind: 'og-image', url: og, sizes: '' });

  return out;
}

module.exports = { collectBrand };
