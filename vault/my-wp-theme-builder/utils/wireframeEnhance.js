/**
 * Post-process wireframe HTML: viewport, responsive baseline, functionality checks.
 */

const WIREFRAME_RESPONSIVE_BASELINE = `
/* responsive baseline */
*, *::before, *::after { box-sizing: border-box; }
img, .img-ph, .map-ph { max-width: 100%; height: auto; }
.header-inner { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
.header-inner nav ul { display: flex; flex-wrap: wrap; gap: 0.75rem; list-style: none; margin: 0; padding: 0; }
.wf-grid { display: grid; gap: 1.5rem; grid-template-columns: 1fr; }
@media (min-width: 768px) {
  .wf-grid--2, .wf-grid.wf-grid--2 { grid-template-columns: repeat(2, 1fr); }
  .wf-grid--3, .wf-grid.wf-grid--3 { grid-template-columns: repeat(3, 1fr); }
  .header-inner { flex-direction: row; justify-content: space-between; }
  .header-inner nav ul { flex-direction: row; }
}
@media (max-width: 767px) {
  .header-inner { flex-direction: column; align-items: stretch; }
  .header-inner nav ul { flex-direction: column; width: 100%; }
  .side-tab, .wf-side-cta, [class*="side-tab"] { display: none !important; }
}
`;

function ensureViewportMeta(html) {
  if (/name=["']viewport["']/i.test(html)) return html;
  if (/<head\b/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, '<head$1>\n<meta name="viewport" content="width=device-width, initial-scale=1">');
  }
  return html;
}

function injectBeforeClosingStyle(html, cssBlock) {
  const trimmed = cssBlock.trim();
  if (!trimmed) return html;
  if (/<\/style>/i.test(html)) {
    return html.replace(/<\/style>/i, `\n${trimmed}\n</style>`);
  }
  if (/<head\b/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, `<head$1>\n<style>${trimmed}\n</style>`);
  }
  return html;
}

function enhanceWireframeDocument(html) {
  return ensureViewportMeta(html);
}

function missingWireframeFunctionality(html, functionality = []) {
  const items = (functionality || []).map((f) => String(f).toLowerCase());
  const missing = [];

  if (items.some((f) => f === 'search') && !/type=["']search["']/i.test(html)) {
    missing.push('Search');
  }
  if (items.some((f) => f.includes('social'))
    && !/(social|facebook|instagram|linkedin|twitter|fa-|icon-)/i.test(html)) {
    missing.push('Social feeds');
  }
  if (items.some((f) => f.includes('google map'))
    && !/(map-ph|google map|map embed|iframe[^>]*map)/i.test(html)) {
    missing.push('Google Map');
  }
  if (items.some((f) => f.includes('google review'))
    && !/(google review|★|&#9733;|star|rating)/i.test(html)) {
    missing.push('Google Reviews');
  }
  if (items.some((f) => f.includes('contact form'))
    && !/<form\b[\s\S]*?<\/form>/i.test(html)) {
    missing.push('Contact form');
  }
  if (items.some((f) => f.includes('newsletter'))
    && !/(newsletter|type=["']email["'])/i.test(html)) {
    missing.push('Newsletter signup');
  }

  return missing;
}

function wireframeLacksResponsiveRules(html) {
  const hasMinWidth = /@media\s*\(\s*min-width\s*:\s*768px\s*\)/i.test(html);
  const hasMaxWidth = /@media\s*\(\s*max-width\s*:\s*767px\s*\)/i.test(html)
    || /@media\s*\(\s*max-width\s*:\s*768px\s*\)/i.test(html);
  return !hasMinWidth || !hasMaxWidth;
}

module.exports = {
  WIREFRAME_RESPONSIVE_BASELINE,
  enhanceWireframeDocument,
  missingWireframeFunctionality,
  wireframeLacksResponsiveRules,
  ensureViewportMeta,
};
