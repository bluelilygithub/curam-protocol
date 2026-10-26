#!/usr/bin/env node
/** Topic Research: telling shop pages from articles. Run: node server/services/topicResearch/pageKind.test.js */
'use strict';

const assert = require('assert');
const { urlKind, htmlKind, textKind, classify, isShopPage } = require('./pageKind');

// ---------------------------------------------------------------- addresses
const URLS = [
  ['https://www.amazon.com/dp/B0BX3VRDKT', 'product'],
  ['https://us.amazon.com/Aheaplus-Corner-Bar-Cabinet/dp/B0BX3VRDKT/ref=sr_1_1', 'product'],
  ['https://www.amazon.com/clp/B0BX3VRDKT', 'listing'], // Amazon's browse (category landing) pages
  ['https://shop.example.com/products/blue-widget', 'product'],
  ['https://www.ebay.com.au/itm/1234567', 'product'],
  ['https://www.diy.com/departments/wine-racks/DIY1234.cat', 'listing'],
  ['https://store.example.com/collections/racks', 'listing'],
  ['https://example.com/category/wine-cabinets', 'listing'],
  ['https://example.com/shop/', 'listing'],
  ['https://example.com/cart', 'listing'],
  ['https://www.amazon.com/s?k=wine+cabinet', 'listing'],
  ['https://www.abc.net.au/news/2026-10-20/wine-cellars-and-heat/1234', null],
  ['https://wineracks.com/blogs/the-wineracks-learning-hub/complete-guide-to-wine-cabinets', null],
  ['https://blog.example.com/why-the-product-matters-most', null], // the word in a longer slug is not a marker
  ['https://example.com/products', null], // a bare marker with nothing after it is the products page itself, not an item
  ['not a url', null],
  [undefined, null],
];
for (const [u, want] of URLS) {
  assert.strictEqual(urlKind(u), want, `${u}`);
}

// ---------------------------------------------------------------- markup
const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
assert.strictEqual(htmlKind(`<html>${ld({ '@type': 'Product', name: 'x' })}</html>`), 'product');
assert.strictEqual(htmlKind(`<html>${ld({ '@graph': [{ '@type': 'WebSite' }, { '@type': ['Thing', 'Product'] }] })}</html>`), 'product', 'Product inside a graph, in a type list');
assert.strictEqual(htmlKind(`<html>${ld({ '@type': 'ItemList', itemListElement: [] })}</html>`), 'listing');
assert.strictEqual(htmlKind(`<html>${ld({ '@type': 'NewsArticle', headline: 'h' })}${ld({ '@type': 'Product' })}</html>`), 'article', 'editorial markup beats product markup');
assert.strictEqual(htmlKind('<meta property="og:type" content="product"><body></body>'), 'product');
assert.strictEqual(htmlKind('<meta content="product.item" property="og:type">'), 'product', 'attribute order does not matter');
assert.strictEqual(htmlKind('<meta property="og:type" content="article">'), 'article');
const prices = (n) => Array.from({ length: n }, (_, i) => `<span>$${i + 10}.99</span>`).join(' ');
assert.strictEqual(htmlKind(`<button>Add to cart</button> ${prices(5)}`), 'product', 'add to cart and several prices');
assert.strictEqual(htmlKind(`<button>Add to Basket</button> ${prices(14)}`), 'listing', 'a lot of prices is a list');
assert.strictEqual(htmlKind(`<p>Add to cart</p> ${prices(2)}`), null, 'one button and two prices is not enough');
assert.strictEqual(htmlKind(`<p>This guide mentions a $499.00 unit once.</p>`), null);
assert.strictEqual(htmlKind('<script type="application/ld+json">{broken</script><p>hi</p>'), null, 'broken JSON-LD is ignored');
assert.strictEqual(htmlKind(''), null);
assert.strictEqual(htmlKind(null), null);

// ---------------------------------------------------------------- text
const words = (n) => Array.from({ length: n }, () => 'word').join(' ');
const priceText = (n) => Array.from({ length: n }, (_, i) => `$${i + 20}.00`).join(' ');
assert.strictEqual(textKind(`${words(150)} ${priceText(10)}`), 'listing', 'a short page, mostly prices');
assert.strictEqual(textKind(`${words(2000)} ${priceText(10)}`), null, 'a long page that quotes prices is an article');
assert.strictEqual(textKind(`${words(100)} ${priceText(2)}`), null);
assert.strictEqual(textKind(''), null);

// ---------------------------------------------------------------- combined
assert.strictEqual(classify({ url: 'https://www.amazon.com/dp/B0BX3VRDKT' }), 'product', 'the address alone is enough before a page is read');
assert.strictEqual(classify({ url: 'https://example.com/news/heat-waves' }), 'article');
assert.strictEqual(classify({ url: 'https://example.com/products/review-of-the-year', html: ld({ '@type': 'BlogPosting' }) }), 'article', 'editorial markup beats the address');
assert.strictEqual(classify({ url: 'https://example.com/guide', html: ld({ '@type': 'Product' }) }), 'product', 'product markup on a plain address');
assert.strictEqual(classify({ url: 'https://example.com/guide', text: `${words(100)} ${priceText(10)}` }), 'listing', 'text evidence when nothing else says');
assert.strictEqual(classify({ url: 'https://example.com/guide', html: '<p>x</p>', text: 'A long essay about cooling units.' }), 'article');
assert.strictEqual(classify({}), 'article');
assert.strictEqual(classify(), 'article');
assert.ok(isShopPage('product') && isShopPage('listing') && !isShopPage('article') && !isShopPage(null));

console.log('topicResearch pageKind: all passed');
