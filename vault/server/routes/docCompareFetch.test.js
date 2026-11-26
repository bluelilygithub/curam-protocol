'use strict';

// node server/routes/docCompareFetch.test.js — the DocCompare page fetch and its SSRF guard. No real network: names are answered by a
// fake resolver and the "web sites" are servers on this machine, allowed explicitly through deps (as in utils/safeFetch.test.js).

const assert = require('assert');
const express = require('express');
const http = require('http');
const { isPublicIp } = require('../utils/safeFetch');
const { createDocCompareFetchRouter } = require('./docCompareFetch');

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server;
}

(async () => {
  // ---- the "internet": one local server playing several sites ----
  const hits = [];
  const site = await listen((req, res) => {
    hits.push(req.url);
    const port = site.address().port;
    if (req.url === '/page') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><html><body><main><h1>Hello</h1><p>Copy.</p></main></body></html>'); }
    if (req.url === '/no-type') { res.writeHead(200); return res.end('<!DOCTYPE html><html><body><p>Untyped page</p></body></html>'); }
    if (req.url === '/image') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from('PNG')); }
    if (req.url === '/to-page') { res.writeHead(301, { location: `http://www.site.test:${port}/page` }); return res.end(); }
    if (req.url === '/to-internal') { res.writeHead(302, { location: `http://internal.test:${port}/secret` }); return res.end(); }
    if (req.url === '/to-metadata') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
    if (req.url === '/to-file') { res.writeHead(302, { location: 'file:///etc/passwd' }); return res.end(); }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
    if (req.url === '/huge') { res.writeHead(200, { 'content-type': 'text/html' }); res.write(Buffer.alloc(3000, 'a')); return res.end(Buffer.alloc(3000, 'a')); }
    if (req.url === '/trickle') {
      // keeps sending a byte every 50 ms, so the idle timeout never fires: only the total deadline stops it
      res.writeHead(200, { 'content-type': 'text/html' });
      const t = setInterval(() => res.write('<'), 50);
      req.on('close', () => clearInterval(t));
      return undefined;
    }
    if (req.url === '/secret') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<p>internal secret</p>'); }
    res.writeHead(404); return res.end();
  });
  const port = String(site.address().port);

  // names: site.test (and www.) is "public" and lives on this machine; everything else resolves the way a hostile DNS would answer
  const NAMES = {
    'site.test': ['127.0.0.1'], 'www.site.test': ['127.0.0.1'],
    'internal.test': ['10.0.0.7'], 'metadata.test': ['169.254.169.254'], 'v6-private.test': ['fd00::1'],
    'rebind.test': ['93.184.216.34', '192.168.1.10'], // one public, one private: refused
  };
  // the test server's address is allowed only when it came from resolving site.test; a literal 127.0.0.1 gets the real rule
  let viaSiteName = false;
  const deps = {
    resolve: async (h) => { viaSiteName = /(^|\.)site\.test$/.test(h); if (NAMES[h]) return NAMES[h]; throw new Error('ENOTFOUND'); },
    isAllowedIp: (ip) => { const via = viaSiteName; viaSiteName = false; return ip === '127.0.0.1' && via ? true : isPublicIp(ip); },
    ports: ['80', '443', port],
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); }); // mounted after requireAuth in index.js
  app.use('/fetch', createDocCompareFetchRouter({ deps, limits: { maxBytes: 4000, timeoutMs: 2000, totalTimeoutMs: 600, maxRequests: 1000 } }));
  const api = await listen(app);
  const ask = async (url) => {
    const res = await fetch(`http://127.0.0.1:${api.address().port}/fetch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()).toString('utf8') };
  };
  const refused = async (url, re, label) => {
    const before = hits.length;
    const r = await ask(url);
    assert.ok(r.status === 400 || r.status === 415, `${label}: refused (got ${r.status})`);
    assert.match(r.body.error, re, `${label}: message`);
    return { r, reached: hits.slice(before) };
  };

  // ---- a normal page ----
  let r = await ask(`http://site.test:${port}/page`);
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /<h1>Hello<\/h1>/);
  assert.strictEqual(r.headers.get('x-page-content-type'), 'text/html; charset=utf-8');
  assert.strictEqual(r.headers.get('cache-control'), 'no-store');
  r = await ask(`http://site.test:${port}/to-page`);
  assert.strictEqual(r.status, 200, 'a redirect to another public page is followed');
  assert.strictEqual(r.headers.get('x-final-url'), `http://www.site.test:${port}/page`);
  r = await ask(`http://site.test:${port}/no-type`);
  assert.strictEqual(r.status, 200, 'a page without a content type is accepted when it looks like HTML');

  // ---- schemes and shapes that never leave the server ----
  for (const [url, re] of [
    ['', /Enter the address/], ['not a url', /valid URL/], ['ftp://site.test/page', /Only http/], ['file:///etc/passwd', /Only http/],
    ['javascript:alert(1)', /Only http/], ['data:text/html,<p>x</p>', /Only http/], [`http://user:pass@site.test:${port}/page`, /login/],
    ['http://site.test:8080/page', /standard web ports/], [`http://x/${'a'.repeat(2100)}`, /too long/],
  ]) await refused(url, re, `refuses ${url.slice(0, 40) || '(empty)'}`);

  // ---- addresses that are not on the public internet, written directly ----
  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '0.0.0.0', '10.0.0.1', '172.16.5.4', '192.168.0.1', '169.254.169.254', '100.64.0.1', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:127.0.0.1]', '[::ffff:169.254.169.254]']) {
    // localhost is a name: the fake resolver does not know it, which is also a refusal (DNS); real DNS would give 127.0.0.1, refused below by rule
    await refused(`http://${host}/latest/meta-data/`, /not allowed|Could not find/, `refuses ${host}`);
  }
  // ---- names that resolve to such addresses (after DNS resolution), including a mixed answer ----
  for (const host of ['internal.test', 'metadata.test', 'v6-private.test', 'rebind.test']) await refused(`http://${host}/`, /not allowed/, `refuses ${host}`);

  // ---- redirects are checked again on every hop ----
  let x = await refused(`http://site.test:${port}/to-internal`, /not allowed/, 'redirect to a private address');
  assert.deepStrictEqual(x.reached, ['/to-internal'], 'the internal page is never requested');
  x = await refused(`http://site.test:${port}/to-metadata`, /not allowed/, 'redirect to cloud metadata');
  assert.deepStrictEqual(x.reached, ['/to-metadata']);
  await refused(`http://site.test:${port}/to-file`, /Only http/, 'redirect to file:');
  await refused(`http://site.test:${port}/loop`, /Too many redirects/, 'redirect loop');

  // ---- size, time and type ----
  await refused(`http://site.test:${port}/huge`, /too large/, 'over the size cap');
  const t0 = Date.now();
  await refused(`http://site.test:${port}/trickle`, /timed out/, 'a page that never finishes');
  assert.ok(Date.now() - t0 < 2000, 'the total deadline ends a trickling page, not the idle timeout');
  await refused(`http://site.test:${port}/image`, /not a web page \(image\/png\)/, 'not HTML');

  assert.ok(!hits.includes('/secret'), 'no internal page was ever reached');

  // ---- rate limit: per person, the production default is 30 every 10 minutes ----
  const limited = express();
  limited.use(express.json());
  limited.use((req, _res, next) => { req.user = { id: 2 }; next(); });
  limited.use('/fetch', createDocCompareFetchRouter({ deps, limits: { maxRequests: 2 } }));
  const lim = await listen(limited);
  const statuses = [];
  for (let i = 0; i < 3; i++) statuses.push((await fetch(`http://127.0.0.1:${lim.address().port}/fetch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: `http://site.test:${port}/page` }) })).status);
  assert.deepStrictEqual(statuses, [200, 200, 429], 'the third request in the window is refused');

  lim.close(); api.close(); site.close();
  console.log('docCompareFetch tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
