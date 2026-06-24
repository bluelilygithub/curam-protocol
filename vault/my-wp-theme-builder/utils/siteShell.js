/**
 * Guaranteed site skeleton — nav, stubs, functionality slots, mobile-first CSS.
 * Claude styles the HOME interior; this shell must survive generation.
 */

const { DEFAULT_PAGES } = require('./normalizeIntake');
const { SNIPPETS } = require('./functionalityInject');

const SHELL_MOBILE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body { margin: 0; overflow-x: hidden; font-family: var(--body-font, sans-serif); }
.container { width: 100%; max-width: 72rem; margin: 0 auto; padding: 0 1.25rem; }
.header-inner { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; }
nav ul { display: flex; flex-wrap: wrap; gap: 0.75rem; list-style: none; margin: 0; padding: 0; }
.wf-section { padding: 2.5rem 0; }
.stub-box { min-height: 180px; border: 2px dashed #999; display: flex; align-items: center; justify-content: center; background: #f0f0f0; }
#home { min-height: 40vh; }
@media (max-width: 767px) {
  .header-inner { flex-direction: column; align-items: stretch; }
  nav ul { flex-direction: column; width: 100%; }
  .wf-grid, [class*="grid"] { grid-template-columns: 1fr !important; display: grid !important; gap: 1rem; }
  .hero, .hero-inner, [class*="hero"] { display: flex !important; flex-direction: column !important; }
}
@media (min-width: 768px) {
  .header-inner { flex-direction: row; }
  nav ul { flex-direction: row; }
}
`.trim();

function pageId(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
}

function featureIds(functionality = []) {
  const map = {
    search: 'search',
    'social feeds': 'social',
    'google map': 'map',
    'google reviews': 'reviews',
    'contact form': 'contact',
    'newsletter signup': 'newsletter',
    blog: 'blog',
    'portfolio/gallery': 'portfolio',
    ecommerce: 'ecommerce',
    booking: 'booking',
    multilingual: 'multilingual',
  };
  const ids = [];
  for (const raw of functionality) {
    const id = map[String(raw).toLowerCase()];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function headerExtras(ids) {
  const parts = [];
  if (ids.includes('search')) parts.push(SNIPPETS.search);
  if (ids.includes('multilingual')) parts.push(SNIPPETS.multilingual);
  return parts.join('\n');
}

function footerExtras(ids) {
  const parts = [];
  if (ids.includes('social')) parts.push(SNIPPETS.social);
  if (ids.includes('newsletter')) parts.push(SNIPPETS.newsletter);
  return parts.join('\n');
}

function contactExtras(ids) {
  const parts = [];
  if (ids.includes('map')) parts.push(SNIPPETS.map);
  if (ids.includes('contact')) parts.push(SNIPPETS.contact);
  if (ids.includes('booking')) parts.push(SNIPPETS.booking);
  return parts.join('\n');
}

function homeExtras(ids) {
  const parts = [];
  if (ids.includes('reviews')) parts.push(SNIPPETS.reviews);
  if (ids.includes('blog')) parts.push(SNIPPETS.blog);
  if (ids.includes('portfolio')) parts.push(SNIPPETS.portfolio);
  if (ids.includes('ecommerce')) parts.push(SNIPPETS.ecommerce);
  return parts.join('\n');
}

function buildSiteShell(intakeData = {}) {
  const pages = intakeData.structure?.pages?.length ? intakeData.structure.pages : DEFAULT_PAGES;
  const brand = intakeData.brand || {};
  const primary = brand.primaryColor || '#333';
  const ids = featureIds(intakeData.functionality || []);

  const nav = pages.map((p) => {
    const id = pageId(p);
    return `<li><a href="#${id}">${p}</a></li>`;
  }).join('\n        ');

  const stubs = pages
    .filter((p) => !/^home$/i.test(p))
    .map((p) => {
      const id = pageId(p);
      const extra = id === 'contact' ? contactExtras(ids) : '';
      return `  <section id="${id}" class="wf-section">
    <div class="container">
      <div class="stub-box">${p} — stub</div>
      ${extra}
    </div>
  </section>`;
    }).join('\n\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Site wireframe shell</title>
<style id="tb-shell-css">
:root { --primary: ${primary}; --heading-font: sans-serif; --body-font: sans-serif; }
${SHELL_MOBILE_CSS}
</style>
</head>
<body>
<header id="tb-header" class="site-header" data-tb-region="header">
  <div class="container header-inner">
    <div class="site-logo">Site name</div>
    <nav id="site-navigation" aria-label="Main" data-tb-region="navigation">
      <ul>
        ${nav}
      </ul>
    </nav>
    ${headerExtras(ids)}
  </div>
</header>
<main>
  <section id="home" class="wf-section" data-tb-home="replace-interior">
    <div class="container" id="home-interior">
      <p class="wf-label">HOME — Claude: replace this interior with wireframe sections</p>
      ${homeExtras(ids)}
    </div>
  </section>

${stubs}
</main>
<footer id="tb-footer" class="site-footer" data-tb-region="footer">
  <div class="container">
    ${footerExtras(ids)}
  </div>
</footer>
</body>
</html>`;
}

module.exports = {
  BUILD_SHELL_VERSION: 'shell-v1',
  buildSiteShell,
  featureIds,
};
