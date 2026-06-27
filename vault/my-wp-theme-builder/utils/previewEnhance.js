const { sanitizeDesignHtml } = require('./parseDesign');
const { guaranteeFunctionality } = require('./functionalityInject');
const { ensureStylesheetLinks } = require('./responsiveCss');
const { injectMobileBaselineHtml } = require('./mobileBaseline');
const { ensureViewportMeta } = require('./wireframeEnhance');
const { assetUrl } = require('./mountPath');

const WIREFRAME_PREVIEW_CHROME = `<style id="tb-wireframe-chrome">
body::before {
  content: "WIREFRAME — structure only. Use Iterate to refine, then Approve wireframe to design.";
  display: block;
  position: sticky;
  top: 0;
  z-index: 99998;
  padding: 0.4rem 0.75rem;
  font: 600 11px/1.3 system-ui, sans-serif;
  letter-spacing: 0.02em;
  text-align: center;
  color: #1e293b;
  background: #fde68a;
  border-bottom: 2px solid #f59e0b;
}
</style>`;

function injectExtraCss(html, extraCss) {
  if (!extraCss) return html;
  const styleTag = `<style id="preview-extracted-css">\n${extraCss}\n</style>`;
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${styleTag}\n</head>`);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${styleTag}`);
  }
  return `${styleTag}${html}`;
}

function applyPreviewBaseTag(html, sessionId, baseHref) {
  const href = baseHref || assetUrl(`/preview/${sessionId}/`);
  const baseTag = `<base href="${href}">`;
  if (/<base\s/i.test(html)) return html;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }
  return `${baseTag}${html}`;
}

function ensurePreviewStylesheets(html, { cssVersion } = {}) {
  let out = html;
  const bust = cssVersion ? `?v=${cssVersion}` : `?t=${Date.now()}`;

  if (!/<link[^>]+href=["']style\.css/i.test(out)) {
    const link = `<link rel="stylesheet" href="style.css${bust}">`;
    if (/<\/head>/i.test(out)) {
      out = out.replace(/<\/head>/i, `${link}\n</head>`);
    } else {
      out = `${link}\n${out}`;
    }
  } else {
    out = out.replace(
      /<link([^>]+)href=["']style\.css(?:\?[^"']*)?["']/gi,
      `<link$1href="style.css${bust}"`
    );
  }

  return out;
}

function injectIterateOverrides(html, iterateCss) {
  const block = String(iterateCss || '').trim();
  if (!block) return html;
  const withoutOld = html.replace(/<style id=["']tb-iterate-overrides["'][^>]*>[\s\S]*?<\/style>/gi, '');
  const styleTag = `<style id="tb-iterate-overrides">\n${block}\n</style>`;
  if (/<\/body>/i.test(withoutOld)) {
    return withoutOld.replace(/<\/body>/i, `${styleTag}\n</body>`);
  }
  if (/<\/head>/i.test(withoutOld)) {
    return withoutOld.replace(/<\/head>/i, `${styleTag}\n</head>`);
  }
  return `${withoutOld}\n${styleTag}`;
}

/**
 * Full preview pipeline — sanitize Claude output, then apply guaranteed features LAST
 * so hamburger nav, map image, and override CSS are never stripped.
 */
function buildPreviewHtml(html, {
  sessionId,
  functionality = [],
  hasResponsive = false,
  wireframe = false,
  iterateCss = '',
  cssVersion = null,
  baseHref = null,
} = {}) {
  const { html: cleaned, extraCss } = sanitizeDesignHtml(html);
  let out = injectExtraCss(cleaned, extraCss);
  out = guaranteeFunctionality(out, functionality);
  out = ensureViewportMeta(out);

  out = ensurePreviewStylesheets(out, { cssVersion });

  if (hasResponsive) {
    out = ensureStylesheetLinks(out);
    if (cssVersion) {
      out = out.replace(
        /<link([^>]+)href=["']responsive\.css(?:\?[^"']*)?["']/gi,
        `<link$1href="responsive.css?v=${cssVersion}"`
      );
    }
  } else if (wireframe) {
    out = injectMobileBaselineHtml(out);
    if (!/id=["']tb-wireframe-chrome["']/i.test(out)) {
      if (/<\/head>/i.test(out)) {
        out = out.replace(/<\/head>/i, `${WIREFRAME_PREVIEW_CHROME}\n</head>`);
      } else {
        out = `${WIREFRAME_PREVIEW_CHROME}${out}`;
      }
    }
  }

  const pickerSrc = `${assetUrl('/preview-picker.js')}?v=41`;
  if (!/<script[^>]+preview-picker\.js/i.test(out)) {
    const picker = `<script src="${pickerSrc}" defer></script>`;
    if (/<\/body>/i.test(out)) {
      out = out.replace(/<\/body>/i, `${picker}\n</body>`);
    } else {
      out = `${out}\n${picker}`;
    }
  }

  if (sessionId || baseHref) {
    out = applyPreviewBaseTag(out, sessionId, baseHref);
  }

  out = injectIterateOverrides(out, iterateCss);

  return out;
}

module.exports = {
  injectExtraCss,
  applyPreviewBaseTag,
  ensurePreviewStylesheets,
  injectIterateOverrides,
  buildPreviewHtml,
};
