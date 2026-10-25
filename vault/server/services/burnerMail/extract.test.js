'use strict';

const assert = require('assert');
const { extractCodes, extractLinks } = require('./extract');

// codes
assert.deepStrictEqual(extractCodes('Your verification code', 'Your verification code is 482913. It expires in 10 minutes.'), ['482913']);
assert.deepStrictEqual(extractCodes('Confirm your email', 'Use this code to continue:\n\n731 904\n\nThanks'), ['731904']);
assert.deepStrictEqual(extractCodes('Welcome', 'Founded in 2019. Order 55 shipped.'), [], 'no hint word, no code');
assert.deepStrictEqual(extractCodes('Your code', 'Security code: 2024'), [], 'a year is not a code');
assert.ok(extractCodes('Sign in', 'Your one-time code: G7H2K9').includes('G7H2K9'));

// links
const html = `<p>Hi</p><a href="https://app.example.com/verify?token=abc&amp;u=1">Confirm your email</a>
  <a href="https://example.com/unsubscribe?x=1">Unsubscribe</a><img src="https://example.com/o.png">
  <a href="javascript:alert(1)">bad</a><a href="https://example.com/blog">Blog</a>`;
const links = extractLinks(html, '');
assert.strictEqual(links[0].url, 'https://app.example.com/verify?token=abc&u=1');
assert.strictEqual(links[0].likely, true);
assert.ok(!links.some((l) => /unsubscribe|javascript/.test(l.url)));
assert.ok(links.some((l) => l.url === 'https://example.com/blog'));
assert.strictEqual(extractLinks('', 'Open https://x.io/activate/42. Thanks')[0].url, 'https://x.io/activate/42');

console.log('burnerMail extract: ok');
