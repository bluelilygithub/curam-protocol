'use strict';

// Topic Research: is a page an article, or a shop page (a product, or a list of products)? Shop pages sell things; they are not coverage of a
// topic, so a search that returns them should not rank them as if they were, and a brief should not be written from them. Pure code, three
// kinds of evidence, strongest first:
//   - the address: /dp/, /product/, /products/, /collections/, /category/ ... as a whole path segment;
//   - the page's own markup: schema.org Product or ItemList data, og:type product, "add to cart" next to several prices;
//   - the text: a short page with many prices.
// Editorial markup (schema.org Article, NewsArticle, BlogPosting, an og:type of article) overrides the address, so a news story that happens to
// live under /products/ is still an article. Anything not recognised is an article: the safe default is to leave a page alone.
// See docs/topic-research.md.

const PRODUCT_SEGMENTS = new Set(['dp', 'gp', 'product', 'products', 'item', 'itm', 'pd']);
const LISTING_SEGMENTS = new Set(['collections', 'category', 'categories', 'shop', 'browse', 'cart', 'basket', 'checkout', 'department', 'departments', 'cat', 'clp', 'brand', 'brands', 'sale', 'deals']);
const PRICE = /(?:\$|AUD|USD|A\$|£|€)\s?\d[\d,]*(?:\.\d{2})?/g;
const ADD_TO_CART = /add[\s-]*to[\s-]*(?:cart|basket|bag|trolley)/i;

/** 'product' | 'listing' | null from the address alone. */
function urlKind(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const segs = u.pathname.toLowerCase().split('/').filter(Boolean);
  // a product address has its marker segment followed by something (the item): "/dp/B0123", "/products/blue-widget"
  for (let i = 0; i < segs.length - 1; i += 1) if (PRODUCT_SEGMENTS.has(segs[i])) return 'product';
  if (segs.some((s) => LISTING_SEGMENTS.has(s))) return 'listing';
  if (/^\/s\/?$/.test(u.pathname) && (u.searchParams.has('k') || u.searchParams.has('q'))) return 'listing'; // a search-results page
  return null;
}

const jsonLdTypes = (html) => {
  const types = new Set();
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    let data;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const walk = (node, depth) => {
      if (!node || depth > 4) return;
      if (Array.isArray(node)) { node.forEach((n) => walk(n, depth + 1)); return; }
      if (typeof node !== 'object') return;
      const t = node['@type'];
      for (const x of Array.isArray(t) ? t : [t]) if (typeof x === 'string') types.add(x);
      walk(node['@graph'], depth + 1);
    };
    walk(data, 0);
  }
  return types;
};

/** 'article' | 'product' | 'listing' | null from a page's markup (null: nothing conclusive). */
function htmlKind(html) {
  const h = String(html || '');
  if (!h) return null;
  const types = jsonLdTypes(h);
  if ([...types].some((t) => /^(Article|NewsArticle|BlogPosting|Report|ScholarlyArticle|TechArticle)$/.test(t))) return 'article';
  const og = (h.match(/<meta[^>]+property=["']og:type["'][^>]+content=["']([^"']+)["']/i) || h.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:type["']/i) || [])[1];
  if (og && /^article$/i.test(og)) return 'article';
  if (types.has('Product') || types.has('ProductGroup') || (og && /product/i.test(og))) return 'product';
  if (types.has('ItemList') || types.has('OfferCatalog')) return 'listing';
  const prices = (h.match(PRICE) || []).length;
  if (ADD_TO_CART.test(h) && prices >= 4) return prices >= 12 ? 'listing' : 'product';
  return null;
}

/** 'listing' | null from the readable text alone: a short page that is mostly prices. */
function textKind(text) {
  const t = String(text || '');
  const words = t.split(/\s+/).filter(Boolean).length;
  const prices = (t.match(PRICE) || []).length;
  if (words > 0 && words < 600 && prices >= 6 && prices / words > 0.03) return 'listing';
  return null;
}

/**
 * The page's kind from everything known: { url, html?, text? }. Editorial markup wins; then a product or listing address or markup; then the
 * text; otherwise 'article'. With only an address (a page not read yet) it still says 'product' or 'listing' when the address says so,
 * and 'article' otherwise.
 */
function classify({ url, html, text } = {}) {
  const fromHtml = htmlKind(html);
  if (fromHtml === 'article') return 'article';
  const fromUrl = urlKind(url);
  if (fromUrl === 'product' || fromHtml === 'product') return 'product';
  if (fromUrl === 'listing' || fromHtml === 'listing') return 'listing';
  return textKind(text) || 'article';
}

const isShopPage = (kind) => kind === 'product' || kind === 'listing';

module.exports = { urlKind, htmlKind, textKind, classify, isShopPage };
