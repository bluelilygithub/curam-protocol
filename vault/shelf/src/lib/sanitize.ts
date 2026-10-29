// Everything copied is untrusted: a web page's HTML, a vector drawing from a design tool. Before it is drawn it goes through DOMPurify with
// the strictest settings that still let ordinary content look right. Two layers on top: an SVG is shown as a picture (an <img> from a blob:),
// where the browser itself refuses to run script or load anything outside; and HTML is shown in a sandboxed frame with no script allowed and a
// policy that blocks every network request. A failure in one layer does not open the others.

import createDOMPurify from 'dompurify';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SAFE_IMG = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const BAD_STYLE = /url\s*\(|@import|expression\s*\(|javascript:|behavior\s*:/i;

// script, embedded pages, form controls, anything that can fetch or navigate, and SVG animation (which can rewrite a link after the check)
const FORBID_COMMON = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'foreignObject', 'handler', 'listener'];
const FORBID_SVG = [...FORBID_COMMON, 'style', 'animate', 'set', 'animateMotion', 'animateTransform', 'use', 'image', 'a'];
// <style> goes too: a page's stylesheet can reach out for fonts and pictures. Inline style="" stays, minus anything with url() (see the hook).
const FORBID_HTML = [...FORBID_COMMON, 'style', 'form', 'input', 'button', 'textarea', 'select', 'option', 'audio', 'video', 'source', 'track', 'canvas', 'svg', 'math'];
const FORBID_ATTRS = ['srcset', 'formaction', 'action', 'ping', 'xlink:href', 'href', 'src', 'poster', 'background', 'data'];

function makeSvgPurifier() {
  const p = createDOMPurify(window);
  p.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName === 'style' && BAD_STYLE.test(data.attrValue)) data.keepAttr = false;
  });
  return p;
}
function makeHtmlPurifier() {
  const p = createDOMPurify(window);
  p.addHook('uponSanitizeAttribute', (node, data) => {
    if (data.attrName === 'style' && BAD_STYLE.test(data.attrValue)) data.keepAttr = false;
    // a picture may stay only when it carries its own bytes: no address that could be fetched (tracking pixels, remote content)
    if (data.attrName === 'src' && node.nodeName.toLowerCase() === 'img') data.keepAttr = SAFE_IMG.test(data.attrValue.trim());
  });
  return p;
}

let svgPurifier: ReturnType<typeof createDOMPurify> | null = null;
let htmlPurifier: ReturnType<typeof createDOMPurify> | null = null;

/** A clean copy of an SVG, or null when nothing drawable is left (not an SVG, or only script). */
export function sanitizeSvg(svg: string): string | null {
  svgPurifier ??= makeSvgPurifier();
  const clean = svgPurifier.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: FORBID_SVG,
    FORBID_ATTR: FORBID_ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  if (typeof clean !== 'string' || !/<svg[\s>]/i.test(clean)) return null;
  // parsed as HTML the namespace can be lost, and without it a browser will not draw the SVG as a picture
  return /<svg[^>]*\sxmlns=/i.test(clean) ? clean : clean.replace(/<svg/i, `<svg xmlns="${SVG_NS}"`);
}

/** A clean copy of some HTML (no script, no forms, no remote pictures, no links), or '' when nothing is left. */
export function sanitizeHtml(html: string): string {
  htmlPurifier ??= makeHtmlPurifier();
  const clean = htmlPurifier.sanitize(html, {
    FORBID_TAGS: FORBID_HTML,
    FORBID_ATTR: FORBID_ATTRS.filter((a) => a !== 'src'), // src is judged one by one in the hook above
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  });
  return typeof clean === 'string' ? clean : '';
}

/** The page for the sandboxed preview frame: the clean HTML, a policy that blocks all network, and the tray's own colours. */
export function htmlPreviewDocument(cleanHtml: string): string {
  const policy = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">`
    + '<style>:root{color-scheme:light dark}body{margin:0;padding:8px;font:13px/1.45 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;word-break:break-word}img{max-width:100%;height:auto}</style>'
    + `</head><body>${cleanHtml}</body></html>`;
}

/** A blob: address for a clean SVG. The caller must revoke it (URL.revokeObjectURL) when the preview closes, so nothing lingers in memory. */
export function svgBlobUrl(cleanSvg: string): string {
  return URL.createObjectURL(new Blob([cleanSvg], { type: 'image/svg+xml' }));
}
