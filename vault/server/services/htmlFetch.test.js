'use strict';

// node server/services/htmlFetch.test.js   (npm run test:html-fetch). No network: DNS answers are faked by replacing dns.lookup.
// htmlFetch resolves names through utils/safeFetch, which calls dns.lookup at request time, so the fake is seen.

const assert = require('assert');
const dns = require('dns');
const http = require('http');

const answers = {
  'internal.test': ['10.0.0.5'],
  'loopback.test': ['127.0.0.1'],
  'metadata.test': ['169.254.169.254'],
  'mixed.test': ['93.184.216.34', '10.1.2.3'],
  'mapped.test': ['::ffff:10.0.0.1'],
  'ula.test': ['fd00::1'],
  'cgnat.test': ['100.64.0.9'],
};
const realLookup = dns.lookup;
dns.lookup = (host, opts, cb) => {
  const callback = typeof opts === 'function' ? opts : cb;
  const options = typeof opts === 'function' ? {} : opts || {};
  if (host in answers) {
    const list = answers[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    return process.nextTick(() => (options.all ? callback(null, list) : callback(null, list[0].address, list[0].family)));
  }
  if (host.endsWith('.nxdomain')) return process.nextTick(() => callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })));
  return realLookup(host, opts, cb);
};

const { checkSsrf, fetchHtml, fetchDirect } = require('./htmlFetch');
const { pinnedLookup } = require('../utils/safeFetch');

const PRIVATE = 'URL resolves to a private or internal address';

(async () => {
  // ---- the guard refuses anything that is not purely public, with the messages callers already show ----
  for (const host of ['internal.test', 'loopback.test', 'metadata.test', 'mixed.test', 'mapped.test', 'ula.test', 'cgnat.test', '127.0.0.1', '[::1]', '169.254.169.254', '0.0.0.0']) {
    await assert.rejects(checkSsrf(host), (e) => { assert.strictEqual(e.message, PRIVATE, host); return true; }, `${host} is refused`);
  }
  await assert.rejects(checkSsrf('gone.nxdomain'), /DNS lookup failed/);

  // ---- and fetching refuses them before any connection is made ----
  for (const url of ['http://internal.test/', 'https://metadata.test/latest/meta-data/', 'http://mixed.test/', 'http://[::ffff:10.0.0.1]/', 'http://localhost/', 'http://2130706433/', 'http://0x7f.1/']) {
    await assert.rejects(fetchHtml(url), (e) => { assert.strictEqual(e.message, PRIVATE, url); return true; });
    await assert.rejects(fetchDirect(url), /private or internal/);
  }

  // ---- the lookup is pinned: the request connects to the address we checked, whatever the name would resolve to ----
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(`host=${req.headers.host}`); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const body = await new Promise((resolve, reject) => {
    // 'never-resolves.nxdomain' has no DNS answer at all; it only works because the connection goes to the pinned address.
    http.get({ hostname: 'never-resolves.nxdomain', port, path: '/', lookup: pinnedLookup('127.0.0.1') }, (res) => {
      let data = ''; res.on('data', (c) => { data += c; }); res.on('end', () => resolve(data));
    }).on('error', reject);
  });
  assert.strictEqual(body, `host=never-resolves.nxdomain:${port}`, 'connected to the pinned address while keeping the Host header');
  const shapes = [];
  pinnedLookup('203.0.113.9')('x', { all: true }, (e, v) => shapes.push(v));
  pinnedLookup('203.0.113.9')('x', {}, (e, a, f) => shapes.push([a, f]));
  assert.deepStrictEqual(shapes, [[{ address: '203.0.113.9', family: 4 }], ['203.0.113.9', 4]], 'both lookup callback shapes are answered');
  server.close();

  console.log('htmlFetch tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
