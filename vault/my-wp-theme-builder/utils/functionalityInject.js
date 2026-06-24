const { injectMobileBaselineHtml } = require('./mobileBaseline');
const { ensureMobileNav } = require('./mobileNav');
const {
  MAP_PLACEHOLDER_IMG,
  MAP_PLACEHOLDER_CSS,
  MAP_IMG_TAG,
  upgradeMapPlaceholders,
} = require('./mapPlaceholder');
const { stampRegionIds } = require('./regionIds');
const FEATURE_BY_LABEL = {
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

const MAP_SNIPPET = `
<div class="map-ph tb-map" id="tb-map" data-tb-region="map" aria-label="Google Map placeholder">
  ${MAP_IMG_TAG}
</div>`.trim();

const SNIPPETS = {
  search: `
<form class="tb-search" id="tb-search" data-tb-region="search" role="search" action="#" method="get">
  <label class="visually-hidden" for="tb-search-input">Search</label>
  <input id="tb-search-input" type="search" name="q" placeholder="Search…">
  <button type="submit">Search</button>
</form>`.trim(),

  social: `
<div class="tb-social" aria-label="Social links">
  <a href="#" aria-label="Facebook">Facebook</a>
  <a href="#" aria-label="Instagram">Instagram</a>
  <a href="#" aria-label="LinkedIn">LinkedIn</a>
</div>`.trim(),

  map: MAP_SNIPPET,

  reviews: `
<section class="tb-reviews" aria-label="Google Reviews">
  <div class="container">
    <h2 class="tb-reviews__title">Google Reviews</h2>
    <div class="tb-reviews__grid">
      <article class="tb-review-card">
        <p class="tb-review-stars" aria-label="5 stars">★★★★★</p>
        <p class="tb-review-quote">"Excellent service — highly recommend."</p>
        <p class="tb-review-author">— Alex M. · Google Review</p>
      </article>
      <article class="tb-review-card">
        <p class="tb-review-stars" aria-label="5 stars">★★★★★</p>
        <p class="tb-review-quote">"Professional, friendly, and on time."</p>
        <p class="tb-review-author">— Jamie L. · Google Review</p>
      </article>
      <article class="tb-review-card">
        <p class="tb-review-stars" aria-label="5 stars">★★★★★</p>
        <p class="tb-review-quote">"Would use again without hesitation."</p>
        <p class="tb-review-author">— Sam R. · Google Review</p>
      </article>
    </div>
  </div>
</section>`.trim(),

  contact: `
<form class="tb-contact-form" action="#" method="post">
  <h3 class="tb-form-title">Contact us</h3>
  <label>Name <input type="text" name="name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Message <textarea name="message" rows="4" required></textarea></label>
  <button type="submit">Send message</button>
</form>`.trim(),

  newsletter: `
<form class="tb-newsletter" action="#" method="post">
  <h3 class="tb-form-title">Newsletter</h3>
  <p class="tb-form-hint">Get updates in your inbox.</p>
  <label class="visually-hidden" for="tb-newsletter-email">Email</label>
  <input id="tb-newsletter-email" type="email" name="email" placeholder="Your email" required>
  <button type="submit">Subscribe</button>
</form>`.trim(),

  blog: `
<section class="tb-blog" id="blog" aria-label="Blog previews">
  <div class="container">
    <h2 class="tb-section-title">Blog</h2>
    <div class="tb-blog-grid">
      <article class="tb-blog-card"><h3>Latest insights</h3><p>Short excerpt from a recent article.</p><a href="#">Read more</a></article>
      <article class="tb-blog-card"><h3>Industry update</h3><p>Another article preview for visitors.</p><a href="#">Read more</a></article>
      <article class="tb-blog-card"><h3>How we help</h3><p>A third blog teaser card.</p><a href="#">Read more</a></article>
    </div>
  </div>
</section>`.trim(),

  portfolio: `
<section class="tb-portfolio" id="portfolio" aria-label="Portfolio gallery">
  <div class="container">
    <h2 class="tb-section-title">Portfolio</h2>
    <div class="tb-portfolio-grid">
      <div class="tb-portfolio-item img-ph">Project 1</div>
      <div class="tb-portfolio-item img-ph">Project 2</div>
      <div class="tb-portfolio-item img-ph">Project 3</div>
      <div class="tb-portfolio-item img-ph">Project 4</div>
      <div class="tb-portfolio-item img-ph">Project 5</div>
      <div class="tb-portfolio-item img-ph">Project 6</div>
    </div>
  </div>
</section>`.trim(),

  ecommerce: `
<section class="tb-shop" aria-label="Products">
  <div class="container">
    <h2 class="tb-section-title">Shop</h2>
    <div class="tb-product-grid">
      <article class="tb-product-card"><div class="img-ph">Product</div><h3>Sample product</h3><p class="tb-price">$49.00</p><button type="button">Add to cart</button></article>
      <article class="tb-product-card"><div class="img-ph">Product</div><h3>Sample product</h3><p class="tb-price">$59.00</p><button type="button">Add to cart</button></article>
      <article class="tb-product-card"><div class="img-ph">Product</div><h3>Sample product</h3><p class="tb-price">$39.00</p><button type="button">Add to cart</button></article>
    </div>
  </div>
</section>`.trim(),

  booking: `
<form class="tb-booking" action="#" method="post">
  <h3 class="tb-form-title">Book an appointment</h3>
  <label>Date <input type="date" name="date" required></label>
  <label>Name <input type="text" name="name" required></label>
  <label>Email <input type="email" name="email" required></label>
  <label>Service <input type="text" name="service" placeholder="Service type"></label>
  <button type="submit">Request booking</button>
</form>`.trim(),

  multilingual: `
<div class="tb-lang-switcher" aria-label="Language switcher">
  <a href="#" aria-current="true">EN</a>
  <span aria-hidden="true">|</span>
  <a href="#">FR</a>
</div>`.trim(),
};

const SEARCH_LAYOUT_CSS = `
.tb-search,
form.tb-search,
.header-utils .tb-search {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: nowrap !important;
  align-items: center !important;
  gap: 0.5rem !important;
  margin: 0.5rem 0 !important;
}
.tb-search input[type="search"],
.tb-search input[type="text"] {
  flex: 1 1 auto !important;
  min-width: 0 !important;
  width: auto !important;
  margin: 0 !important;
}
.tb-search button,
.tb-search input[type="submit"] {
  flex: 0 0 auto !important;
  white-space: nowrap !important;
  margin: 0 !important;
}
`.trim();

const COMPONENT_CSS = `
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }
${SEARCH_LAYOUT_CSS}
.tb-contact-form, .tb-newsletter, .tb-booking { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin: 0.75rem 0; }
.tb-contact-form input, .tb-contact-form textarea, .tb-newsletter input, .tb-booking input { flex: 1 1 10rem; min-width: 0; padding: 0.45rem 0.6rem; }
.tb-contact-form, .tb-booking { flex-direction: column; align-items: stretch; max-width: 32rem; }
.tb-contact-form label, .tb-booking label { display: flex; flex-direction: column; gap: 0.25rem; width: 100%; }
.tb-social { display: flex; flex-wrap: wrap; gap: 0.75rem; margin: 0.75rem 0; }
.tb-social a { text-decoration: none; }
.map-ph, .tb-map { position: relative; overflow: hidden; width: 100%; }
.tb-reviews, .tb-blog, .tb-portfolio, .tb-shop { padding: 2rem 0; }
.tb-reviews__grid, .tb-blog-grid, .tb-portfolio-grid, .tb-product-grid { display: grid; gap: 1rem; grid-template-columns: 1fr; }
.tb-review-card, .tb-blog-card, .tb-product-card { padding: 1rem; border: 1px solid #ddd; border-radius: 6px; }
.tb-review-stars { color: #f5a623; margin: 0 0 0.5rem; }
.tb-portfolio-item { min-height: 120px; display: flex; align-items: center; justify-content: center; background: #eee; }
.tb-lang-switcher { display: flex; gap: 0.5rem; align-items: center; margin: 0.5rem 0; }
.tb-form-title { margin: 0 0 0.5rem; width: 100%; }
`.trim();

function normalizeFeatureIds(functionality = []) {
  const ids = [];
  for (const raw of functionality) {
    const key = String(raw).toLowerCase();
    const id = FEATURE_BY_LABEL[key];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function hasFeature(html, id) {
  switch (id) {
    case 'search':
      return /class=["'][^"']*tb-search/i.test(html) || /type=["']search["']/i.test(html);
    case 'social':
      return /class=["'][^"']*tb-social/i.test(html);
    case 'map':
      return /class=["'][^"']*(map-ph|tb-map|map-placeholder|contact-map|map-embed|google-map)/i.test(html)
        || /tb-map-img/i.test(html);
    case 'reviews':
      return /class=["'][^"']*tb-reviews/i.test(html);
    case 'contact':
      return /class=["'][^"']*tb-contact-form/i.test(html);
    case 'newsletter':
      return /class=["'][^"']*tb-newsletter/i.test(html);
    case 'blog':
      return /class=["'][^"']*tb-blog/i.test(html) || /<section\b[^>]*id=["']blog["']/i.test(html);
    case 'portfolio':
      return /class=["'][^"']*tb-portfolio/i.test(html) || /<section\b[^>]*id=["']portfolio["']/i.test(html);
    case 'ecommerce':
      return /class=["'][^"']*tb-shop/i.test(html) || /class=["'][^"']*tb-product/i.test(html);
    case 'booking':
      return /class=["'][^"']*tb-booking/i.test(html);
    case 'multilingual':
      return /class=["'][^"']*tb-lang-switcher/i.test(html);
    default:
      return false;
  }
}

function injectBeforeClosingTag(html, tag, snippet) {
  const re = new RegExp(`<\\/${tag}>`, 'i');
  if (!re.test(html)) return `${html}\n${snippet}`;
  const parts = html.split(re);
  parts[parts.length - 2] = `${parts[parts.length - 2]}\n${snippet}\n`;
  return parts.join(`</${tag}>`);
}

function injectIntoHeader(html, snippet) {
  if (/<header\b[\s\S]*?<\/header>/i.test(html)) {
    return html.replace(/<\/header>/i, `\n${snippet}\n</header>`);
  }
  return html.replace(/<body(\s[^>]*)?>/i, (m) => `${m}\n<header class="tb-header"><div class="container header-inner">${snippet}</div></header>`);
}

function injectIntoFooter(html, snippet) {
  if (/<footer\b[\s\S]*?<\/footer>/i.test(html)) {
    return html.replace(/<footer(\s[^>]*)?>/i, (m) => `${m}\n<div class="container">${snippet}</div>\n`);
  }
  return injectBeforeClosingTag(html, 'body', `<footer class="tb-footer"><div class="container">${snippet}</div></footer>`);
}

function injectIntoSection(html, sectionId, snippet, fallbackTitle) {
  const re = new RegExp(`<section\\b[^>]*id=["']${sectionId}["'][^>]*>[\\s\\S]*?<\\/section>`, 'i');
  const match = html.match(re);
  if (match) {
    const updated = match[0].replace(/<\/section>/i, `\n<div class="container">${snippet}</div>\n</section>`);
    return html.replace(match[0], updated);
  }
  return injectBeforeClosingTag(
    html,
    'body',
    `<section id="${sectionId}" class="wf-section"><div class="container"><h2>${fallbackTitle}</h2>${snippet}</div></section>`
  );
}

function injectFeature(html, id) {
  switch (id) {
    case 'search':
      return injectIntoHeader(html, SNIPPETS.search);
    case 'social':
      return injectIntoFooter(html, SNIPPETS.social);
    case 'map':
      return injectIntoSection(html, 'contact', SNIPPETS.map, 'Contact');
    case 'reviews':
      if (/<main\b/i.test(html)) {
        return html.replace(/<main(\s[^>]*)?>/i, (m) => `${m}\n${SNIPPETS.reviews}\n`);
      }
      return html.replace(/<body(\s[^>]*)?>/i, (m) => `${m}\n${SNIPPETS.reviews}\n`);
    case 'contact':
      return injectIntoSection(html, 'contact', SNIPPETS.contact, 'Contact');
    case 'newsletter':
      return injectIntoFooter(html, SNIPPETS.newsletter);
    case 'blog':
      return injectBeforeClosingTag(html, 'body', SNIPPETS.blog);
    case 'portfolio':
      return injectBeforeClosingTag(html, 'body', SNIPPETS.portfolio);
    case 'ecommerce':
      return injectBeforeClosingTag(html, 'body', SNIPPETS.ecommerce);
    case 'booking':
      return injectIntoSection(html, 'contact', SNIPPETS.booking, 'Contact');
    case 'multilingual':
      return injectIntoHeader(html, SNIPPETS.multilingual);
    default:
      return html;
  }
}

function listMissingFeatures(html, functionality = []) {
  return normalizeFeatureIds(functionality).filter((id) => !hasFeature(html, id));
}

function injectEnsuredStyles(html) {
  const css = `${MAP_PLACEHOLDER_CSS}\n\n${COMPONENT_CSS}`;
  const block = `<style id="tb-ensured">\n${css}\n</style>`;
  let out = html.replace(/<style id=["']tb-ensured["'][^>]*>[\s\S]*?<\/style>/gi, '');
  if (/<\/body>/i.test(out)) {
    return out.replace(/<\/body>/i, `${block}\n</body>`);
  }
  if (/<\/head>/i.test(out)) {
    return out.replace(/<\/head>/i, `${block}\n</head>`);
  }
  return `${out}\n${block}`;
}

function postProcessHtml(html) {
  let out = upgradeMapPlaceholders(html);
  out = stampRegionIds(out);
  out = ensureMobileNav(out);
  out = injectEnsuredStyles(out);
  return out;
}

function injectComponentStyles(html) {
  const block = `<style id="tb-components">\n${COMPONENT_CSS}\n</style>`;
  if (/id=["']tb-components["']/i.test(html)) return html;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${block}\n</body>`);
  }
  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${block}\n</head>`);
  }
  return `${html}\n${block}`;
}

function guaranteeFunctionality(html, functionality = []) {
  if (!html) return html;

  let result = html;
  if (functionality?.length) {
    for (let pass = 0; pass < 3; pass += 1) {
      const missing = listMissingFeatures(result, functionality);
      if (!missing.length) break;
      for (const id of missing) {
        result = injectFeature(result, id);
      }
    }
    result = injectComponentStyles(result);
  }

  return postProcessHtml(result);
}

function applyWireframeEnhancements(html, css, functionality = []) {
  let outHtml = guaranteeFunctionality(html, functionality);
  outHtml = injectMobileBaselineHtml(outHtml);
  return { html: outHtml, css: css || '/* wireframe */' };
}

function applyDesignEnhancements(html, css, functionality = []) {
  const outHtml = guaranteeFunctionality(html, functionality);
  return { html: outHtml, css: css || '' };
}

/** @deprecated use applyWireframeEnhancements or applyDesignEnhancements */
function applyGenerationEnhancements(html, css, functionality = []) {
  return applyWireframeEnhancements(html, css, functionality);
}

module.exports = {
  SNIPPETS,
  MAP_PLACEHOLDER_IMG,
  FEATURE_BY_LABEL,
  normalizeFeatureIds,
  hasFeature,
  listMissingFeatures,
  injectFeature,
  upgradeMapPlaceholders,
  guaranteeFunctionality,
  injectComponentStyles,
  applyWireframeEnhancements,
  applyDesignEnhancements,
  applyGenerationEnhancements,
};
