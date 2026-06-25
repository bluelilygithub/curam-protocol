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
  slideshow: 'slideshow',
  carousel: 'carousel',
  parallax: 'parallax',
  video: 'video',
  'masonry gallery': 'masonry',
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

  slideshow: `
<section class="tb-slideshow" id="tb-slideshow" data-tb-region="slideshow" aria-label="Slideshow demo">
  <div class="container">
    <div class="tb-slides">
      <figure class="tb-slide"><img src="https://picsum.photos/seed/tbslide1/1200/600" alt="Slide one"><figcaption>Auto-fading slideshow</figcaption></figure>
      <figure class="tb-slide"><img src="https://picsum.photos/seed/tbslide2/1200/600" alt="Slide two"><figcaption>Each slide cross-fades</figcaption></figure>
      <figure class="tb-slide"><img src="https://picsum.photos/seed/tbslide3/1200/600" alt="Slide three"><figcaption>Loops continuously</figcaption></figure>
    </div>
  </div>
</section>`.trim(),

  carousel: `
<section class="tb-carousel" id="tb-carousel" data-tb-region="carousel" aria-label="Carousel demo">
  <div class="container">
    <div class="tb-carousel__viewport">
      <button class="tb-carousel__btn tb-carousel__btn--prev" type="button" aria-label="Previous slide">&#8249;</button>
      <ul class="tb-carousel__track">
        <li class="tb-carousel__slide"><img src="https://picsum.photos/seed/tbcar1/640/420" alt="Item one"></li>
        <li class="tb-carousel__slide"><img src="https://picsum.photos/seed/tbcar2/640/420" alt="Item two"></li>
        <li class="tb-carousel__slide"><img src="https://picsum.photos/seed/tbcar3/640/420" alt="Item three"></li>
        <li class="tb-carousel__slide"><img src="https://picsum.photos/seed/tbcar4/640/420" alt="Item four"></li>
        <li class="tb-carousel__slide"><img src="https://picsum.photos/seed/tbcar5/640/420" alt="Item five"></li>
      </ul>
      <button class="tb-carousel__btn tb-carousel__btn--next" type="button" aria-label="Next slide">&#8250;</button>
    </div>
    <div class="tb-carousel__dots" aria-label="Carousel navigation"></div>
  </div>
</section>`.trim(),

  parallax: `
<section class="tb-parallax" id="tb-parallax" data-tb-region="parallax" aria-label="Parallax demo" style="background-image:url('https://picsum.photos/seed/tbparallax/1600/900')">
  <div class="tb-parallax__overlay">
    <div class="container">
      <p class="tb-parallax__eyebrow">Parallax</p>
      <h2 class="tb-parallax__title">Scroll to see the effect</h2>
      <p class="tb-parallax__text">The background image stays fixed while the page scrolls over it.</p>
    </div>
  </div>
</section>`.trim(),

  video: `
<section class="tb-video" id="tb-video" data-tb-region="video" aria-label="Video">
  <div class="container">
    <div class="tb-video__frame">
      <video class="tb-video__el" autoplay muted loop playsinline preload="metadata"
        poster="https://picsum.photos/seed/tbvideo/1280/720">
        <source src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4" type="video/mp4">
      </video>
    </div>
  </div>
</section>`.trim(),

  masonry: `
<section class="tb-masonry" id="tb-masonry" data-tb-region="masonry" aria-label="Masonry gallery">
  <div class="container">
    <h2 class="tb-section-title">Gallery</h2>
    <div class="tb-masonry__grid">
      <figure class="tb-masonry__item"><img src="https://picsum.photos/seed/tbm1/600/800" alt="Gallery image 1"></figure>
      <figure class="tb-masonry__item"><img src="https://picsum.photos/seed/tbm2/600/450" alt="Gallery image 2"></figure>
      <figure class="tb-masonry__item"><img src="https://picsum.photos/seed/tbm3/600/650" alt="Gallery image 3"></figure>
      <figure class="tb-masonry__item"><img src="https://picsum.photos/seed/tbm4/600/400" alt="Gallery image 4"></figure>
      <figure class="tb-masonry__item"><img src="https://picsum.photos/seed/tbm5/600/750" alt="Gallery image 5"></figure>
      <figure class="tb-masonry__item"><img src="https://picsum.photos/seed/tbm6/600/520" alt="Gallery image 6"></figure>
      <figure class="tb-masonry__item"><img src="https://picsum.photos/seed/tbm7/600/680" alt="Gallery image 7"></figure>
      <figure class="tb-masonry__item"><img src="https://picsum.photos/seed/tbm8/600/430" alt="Gallery image 8"></figure>
    </div>
  </div>
</section>`.trim(),
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
.tb-contact-form, .tb-booking { flex-direction: column; align-items: stretch; max-width: 32rem; }
.tb-contact-form label, .tb-booking label { display: flex; flex-direction: column; gap: 0.25rem; width: 100%; }
.tb-contact-form input, .tb-contact-form select, .tb-contact-form textarea,
.tb-booking input, .tb-booking select, .tb-booking textarea { flex: 0 0 auto; width: 100%; min-width: 0; height: auto; padding: 0.55rem 0.7rem; font: inherit; }
.tb-contact-form textarea, .tb-booking textarea { min-height: 6rem; resize: vertical; }
.tb-newsletter input { flex: 1 1 10rem; min-width: 0; padding: 0.55rem 0.7rem; }
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

/* Slideshow — CSS-only auto cross-fade */
.tb-slideshow { padding: 2rem 0; }
.tb-slides { position: relative; width: 100%; aspect-ratio: 2 / 1; overflow: hidden; border-radius: 10px; background: #111; }
.tb-slide { position: absolute; inset: 0; margin: 0; opacity: 0; animation: tb-slideshow-fade 15s infinite; }
.tb-slide img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tb-slide figcaption { position: absolute; left: 0; right: 0; bottom: 0; padding: 0.85rem 1.1rem; color: #fff; font-size: 0.95rem; background: linear-gradient(transparent, rgba(0,0,0,0.65)); }
.tb-slide:nth-child(1) { animation-delay: 0s; }
.tb-slide:nth-child(2) { animation-delay: 5s; }
.tb-slide:nth-child(3) { animation-delay: 10s; }
@keyframes tb-slideshow-fade { 0% { opacity: 0; } 3% { opacity: 1; } 30% { opacity: 1; } 36% { opacity: 0; } 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .tb-slide { animation: none; } .tb-slide:nth-child(1) { opacity: 1; } }

/* Carousel — scroll-snap track wired by tb-carousel script */
.tb-carousel { padding: 2rem 0; }
.tb-carousel__viewport { position: relative; display: flex; align-items: center; gap: 0.5rem; }
.tb-carousel__track { display: flex; gap: 1rem; list-style: none; margin: 0; padding: 0.25rem; overflow-x: auto; scroll-snap-type: x mandatory; scroll-behavior: smooth; -webkit-overflow-scrolling: touch; flex: 1 1 auto; }
.tb-carousel__track::-webkit-scrollbar { height: 0; width: 0; }
.tb-carousel__slide { flex: 0 0 80%; scroll-snap-align: center; border-radius: 10px; overflow: hidden; }
.tb-carousel__slide img { width: 100%; height: 100%; aspect-ratio: 3 / 2; object-fit: cover; display: block; }
.tb-carousel__btn { flex: 0 0 auto; width: 2.5rem; height: 2.5rem; border-radius: 50%; border: 0; cursor: pointer; font-size: 1.4rem; line-height: 1; background: var(--primary, #222); color: #fff; }
.tb-carousel__btn:hover { opacity: 0.85; }
.tb-carousel__dots { display: flex; justify-content: center; gap: 0.5rem; margin-top: 0.9rem; }
.tb-carousel__dot { width: 9px; height: 9px; padding: 0; border-radius: 50%; border: 0; cursor: pointer; background: #c5c5c5; }
.tb-carousel__dot[aria-current="true"] { background: var(--primary, #222); }
@media (min-width: 768px) { .tb-carousel__slide { flex-basis: 42%; } }

/* Parallax — fixed background band */
.tb-parallax { position: relative; min-height: 60vh; display: flex; align-items: center; background-size: cover; background-position: center; background-attachment: fixed; }
.tb-parallax__overlay { width: 100%; padding: 4rem 0; background: rgba(0,0,0,0.45); color: #fff; }
.tb-parallax__eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75rem; font-weight: 600; margin: 0 0 0.5rem; }
.tb-parallax__title { margin: 0 0 0.5rem; font-size: clamp(1.75rem, 3vw, 2.5rem); }
.tb-parallax__text { margin: 0; max-width: 40ch; }
@media (max-width: 767px) { .tb-parallax { background-attachment: scroll; } }

/* Video — responsive 16:9 frame */
.tb-video { padding: 2rem 0; }
.tb-video__frame { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 10px; background: #000; }
.tb-video__el, .tb-video__frame iframe { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border: 0; }

/* Masonry gallery — multi-column, varied heights */
.tb-masonry { padding: 2rem 0; }
.tb-masonry__grid { columns: 2; column-gap: 1rem; }
.tb-masonry__item { break-inside: avoid; margin: 0 0 1rem; border-radius: 8px; overflow: hidden; }
.tb-masonry__item img { width: 100%; height: auto; display: block; }
@media (min-width: 768px) { .tb-masonry__grid { columns: 3; } }
@media (min-width: 1100px) { .tb-masonry__grid { columns: 4; } }

/* Standard galleries / card grids — multiple per row on larger screens */
@media (min-width: 600px) {
  .tb-blog-grid, .tb-product-grid, .tb-reviews__grid, .tb-portfolio-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 900px) {
  .tb-blog-grid, .tb-product-grid, .tb-reviews__grid, .tb-portfolio-grid { grid-template-columns: repeat(3, 1fr); }
}
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
    case 'slideshow':
      return /class=["'][^"']*tb-slideshow/i.test(html);
    case 'carousel':
      return /class=["'][^"']*tb-carousel/i.test(html);
    case 'parallax':
      return /class=["'][^"']*tb-parallax/i.test(html);
    case 'video':
      return /class=["'][^"']*tb-video/i.test(html) || /<video\b/i.test(html);
    case 'masonry':
      return /class=["'][^"']*tb-masonry/i.test(html);
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
    case 'slideshow':
      return injectBeforeClosingTag(html, 'main', SNIPPETS.slideshow);
    case 'carousel':
      return injectBeforeClosingTag(html, 'main', SNIPPETS.carousel);
    case 'parallax':
      return injectBeforeClosingTag(html, 'main', SNIPPETS.parallax);
    case 'video':
      return injectBeforeClosingTag(html, 'main', SNIPPETS.video);
    case 'masonry':
      return injectBeforeClosingTag(html, 'main', SNIPPETS.masonry);
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

const CAROUSEL_SCRIPT = `<script id="tb-carousel-js">
(function () {
  document.querySelectorAll('.tb-carousel').forEach(function (root) {
    var track = root.querySelector('.tb-carousel__track');
    if (!track) return;
    var slides = Array.prototype.slice.call(track.children);
    if (!slides.length) return;
    var idx = 0;
    function go(i) {
      idx = (i + slides.length) % slides.length;
      track.scrollTo({ left: slides[idx].offsetLeft - track.offsetLeft, behavior: 'smooth' });
      dots.forEach(function (d, di) { d.setAttribute('aria-current', di === idx ? 'true' : 'false'); });
    }
    var prev = root.querySelector('.tb-carousel__btn--prev');
    var next = root.querySelector('.tb-carousel__btn--next');
    if (prev) prev.addEventListener('click', function () { go(idx - 1); });
    if (next) next.addEventListener('click', function () { go(idx + 1); });
    var dotsWrap = root.querySelector('.tb-carousel__dots');
    var dots = [];
    if (dotsWrap) {
      slides.forEach(function (_, i) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tb-carousel__dot';
        b.setAttribute('aria-label', 'Go to slide ' + (i + 1));
        b.addEventListener('click', function () { go(i); });
        dotsWrap.appendChild(b);
        dots.push(b);
      });
    }
    go(0);
    var timer = setInterval(function () { go(idx + 1); }, 3500);
    root.addEventListener('mouseenter', function () { clearInterval(timer); });
    root.addEventListener('mouseleave', function () { timer = setInterval(function () { go(idx + 1); }, 3500); });
  });
})();
</script>`;

function ensureCarousel(html) {
  if (!/class=["'][^"']*tb-carousel/i.test(html)) return html;
  if (/<script[^>]+id=["']tb-carousel-js["']/i.test(html)) return html;
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${CAROUSEL_SCRIPT}\n</body>`);
  }
  return `${html}\n${CAROUSEL_SCRIPT}`;
}

function postProcessHtml(html) {
  let out = upgradeMapPlaceholders(html);
  out = stampRegionIds(out);
  out = ensureMobileNav(out);
  out = ensureCarousel(out);
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
