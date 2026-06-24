/**
 * Aggressive mobile-first overrides — injected last so they win over model CSS.
 * Fixes previews where desktop multi-column layouts squish instead of stacking.
 */

const { NAV_TOGGLE_CSS } = require('./mobileNav');
const { MAP_PLACEHOLDER_CSS } = require('./mapPlaceholder');

const MOBILE_BASELINE_CSS = `
/* theme-builder mobile stack (injected last) */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { overflow-x: hidden; margin: 0; }
img, video, iframe, svg, picture, .img-ph, .map-ph, .tb-map-img { max-width: 100%; height: auto; }
.container { width: 100%; max-width: 72rem; margin: 0 auto; padding: 0 1.25rem; }

@media (max-width: 767px) {
  html, body { overflow-x: hidden !important; max-width: 100% !important; }

  /* Stack container children — catches most section layouts */
  .container,
  section > div,
  main > section > .container {
    display: flex !important;
    flex-direction: column !important;
    gap: 1rem !important;
    align-items: stretch !important;
  }

  /* Grids → single column (beats inline styles without !important) */
  [style*="grid-template-columns"],
  [class*="grid"],
  [class*="cols"],
  [class*="cards"],
  [class*="features"],
  [class*="services"],
  [class*="portfolio"],
  [class*="gallery"],
  [class*="team"],
  [class*="columns"],
  section > .container,
  section > .container > div,
  section > div,
  main > section > div,
  .wf-grid,
  .hero-inner,
  .hero-content,
  .hero-grid {
    grid-template-columns: 1fr !important;
  }

  /* Flex rows → stack (header/nav excluded — hamburger handles mobile menu) */
  footer,
  footer .container,
  [class*="hero"],
  [class*="banner"],
  [class*="footer"],
  .footer-grid,
  footer [class*="grid"],
  footer .grid,
  [class*="row"]:not(tr):not(thead):not(tbody),
  [class*="flex"],
  [style*="display: flex"],
  [style*="display:flex"] {
    flex-direction: column !important;
    align-items: stretch !important;
  }

  /* Kill fixed widths that break narrow viewports */
  [style*="width:"],
  [class*="hero"] img,
  [class*="hero"] .img-ph {
    max-width: 100% !important;
    width: 100% !important;
  }

  /* Footer multi-column grids → single readable column */
  .footer-grid,
  footer .footer-grid,
  footer [class*="footer-grid"],
  footer [class*="grid"] {
    grid-template-columns: 1fr !important;
    gap: 1.5rem !important;
  }

  /* Hide fixed side chrome */
  .side-tab,
  .wf-side-cta,
  [class*="side-tab"],
  [class*="side-cta"],
  aside[class*="fixed"] {
    display: none !important;
  }

  /* Multi-column text */
  [style*="columns:"] {
    columns: 1 !important;
  }
}

@media (min-width: 768px) {
  .wf-grid--2 { grid-template-columns: repeat(2, 1fr) !important; }
  .wf-grid--3 { grid-template-columns: repeat(3, 1fr) !important; }
  .header-inner, header .container { flex-direction: row; align-items: center; }
  header nav ul, nav ul { flex-direction: row; width: auto; }
}
`.trim();

const FUNCTIONALITY_COMPONENT_CSS = `
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
.tb-search { display: flex; flex-direction: row; flex-wrap: nowrap; gap: 0.5rem; align-items: center; margin: 0.5rem 0; }
.tb-search input[type="search"] { flex: 1 1 auto; min-width: 0; padding: 0.4rem 0.6rem; }
.tb-search button { flex: 0 0 auto; white-space: nowrap; }
.tb-social { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0.75rem 0; }
.tb-social a { text-decoration: none; }
.map-ph, .tb-map { position: relative; overflow: hidden; width: 100%; }
.tb-reviews { padding: 2rem 0; }
.tb-reviews__grid { display: grid; gap: 1.25rem; grid-template-columns: 1fr; }
.tb-review-card { padding: 1rem; border: 1px solid #ddd; border-radius: 6px; }
.tb-review-stars { color: #f5a623; margin: 0 0 0.5rem; letter-spacing: 0.05em; }
`.trim();

function combinedBaselineCss() {
  return `${MAP_PLACEHOLDER_CSS}\n\n${FUNCTIONALITY_COMPONENT_CSS}\n\n${MOBILE_BASELINE_CSS}\n\n${NAV_TOGGLE_CSS}`;
}

function injectMobileBaselineHtml(html) {
  const css = combinedBaselineCss();
  const styleBlock = `<style id="tb-baseline">\n${css}\n</style>`;
  let out = html.replace(/<style id=["']tb-baseline["'][^>]*>[\s\S]*?<\/style>/gi, '');

  // Wireframes use inline <style> in head — append mobile rules there too
  if (/<style[^>]*>[\s\S]*?<\/style>/i.test(out)) {
    out = out.replace(/<\/style>/i, `\n/* tb mobile stack */\n${MOBILE_BASELINE_CSS}\n</style>`);
  }

  if (/<\/body>/i.test(out)) {
    return out.replace(/<\/body>/i, `${styleBlock}\n</body>`);
  }
  if (/<\/head>/i.test(out)) {
    return out.replace(/<\/head>/i, `${styleBlock}\n</head>`);
  }
  return `${out}\n${styleBlock}`;
}

function appendMobileBaselineCss(css = '') {
  const baseline = combinedBaselineCss();
  if (/theme-builder mobile stack/i.test(css)) {
    return css.replace(
      /\/\* theme-builder mobile stack[\s\S]*$/i,
      baseline.slice(baseline.indexOf('/* theme-builder mobile stack'))
    );
  }
  return `${css.trim()}\n\n${baseline}`.trim();
}

module.exports = {
  MOBILE_BASELINE_CSS,
  FUNCTIONALITY_COMPONENT_CSS,
  combinedBaselineCss,
  injectMobileBaselineHtml,
  appendMobileBaselineCss,
};
