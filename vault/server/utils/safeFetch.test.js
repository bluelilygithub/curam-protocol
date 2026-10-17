'use strict';

// node server/utils/safeFetch.test.js   (npm run test:safe-fetch). No network: names are resolved by a fake resolver and
// the "remote" servers are on this machine, which the tests allow explicitly through deps.

const assert = require('assert');
const http = require('http');
const { isPublicIp, fetchPublicFile } = require('./safeFetch');

// ---- the address rules ----
const publicOnes = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8', '100.63.255.255', '172.15.0.1', '172.32.0.1'];
const notPublic = [
  '127.0.0.1', '127.255.255.254', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
  '0.0.0.0', '100.64.0.1', '100.127.255.255', '192.0.0.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
  '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1', 'ff02::1', '2001:db8::1',
  '::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2002:7f00:1::1', '::127.0.0.1',
  'not-an-ip', '', '999.1.1.1',
];
publicOnes.forEach((ip) => assert.strictEqual(isPublicIp(ip), true, `${ip} is public`));
notPublic.forEach((ip) => assert.strictEqual(isPublicIp(ip), false, `${ip} is not public`));

const rejects = async (promise, re, label) => {
  await assert.rejects(promise, (e) => { assert.strictEqual(e.status, 400, `${label}: status`); assert.match(e.message, re, label); return true; });
};

(async () => {
  let hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url, host: req.headers.host });
    if (req.url === '/img') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.from('PNGDATA')); }
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(Buffer.alloc(3000)); }
    if (req.url === '/stream-big') { res.writeHead(200, { 'content-type': 'image/png' }); res.write(Buffer.alloc(2000)); return res.end(Buffer.alloc(2000)); }
    if (req.url === '/to-internal') { res.writeHead(302, { location: `http://internal.test:${server.address().port}/secret` }); return res.end(); }
    if (req.url === '/loop') { res.writeHead(302, { location: '/loop' }); return res.end(); }
    if (req.url === '/missing') { res.writeHead(404); return res.end(); }
    res.writeHead(200); return res.end('ok');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = String(server.address().port);

  // Test doubles: "pub.test" is a public name that happens to live on this machine; "internal.test" is a private address.
  const deps = {
    ports: [port],
    resolve: async (host) => {
      if (host === 'pub.test') return ['127.0.0.1'];
      if (host === 'internal.test') return ['10.0.0.5'];
      if (host === 'mixed.test') return ['127.0.0.1', '10.0.0.5'];
      throw new Error('ENOTFOUND');
    },
    isAllowedIp: (ip) => ip === '127.0.0.1',
  };
  const url = (host, p) => `http://${host}:${port}${p}`;

  try {
    // happy path: fetched, and the connection used the address we resolved while the Host header kept the name
    const ok = await fetchPublicFile(url('pub.test', '/img'), { deps });
    assert.strictEqual(ok.buffer.toString(), 'PNGDATA');
    assert.strictEqual(ok.contentType, 'image/png');
    assert.strictEqual(hits[0].host, `pub.test:${port}`);

    await rejects(fetchPublicFile(url('internal.test', '/img'), { deps }), /not allowed/, 'private name');
    await rejects(fetchPublicFile(url('mixed.test', '/img'), { deps }), /not allowed/, 'one private address among public ones');
    await rejects(fetchPublicFile(url('nowhere.test', '/img'), { deps }), /Could not find/, 'unknown name');
    await rejects(fetchPublicFile(url('pub.test', '/to-internal'), { deps }), /not allowed/, 'redirect to an internal host');
    await rejects(fetchPublicFile(url('pub.test', '/loop'), { deps }), /Too many redirects/, 'redirect loop');
    await rejects(fetchPublicFile(url('pub.test', '/missing'), { deps }), /HTTP 404/, 'missing file');
    await rejects(fetchPublicFile(url('pub.test', '/big'), { deps, maxBytes: 1000 }), /too large/, 'declared size over the cap');
    await rejects(fetchPublicFile(url('pub.test', '/stream-big'), { deps, maxBytes: 1000 }), /too large/, 'streamed size over the cap');

    // rules that never reach the network
    await rejects(fetchPublicFile('not a url'), /valid URL/, 'bad url');
    await rejects(fetchPublicFile('ftp://example.com/a.png'), /http/, 'wrong scheme');
    await rejects(fetchPublicFile('http://user:pw@example.com/a.png'), /login/, 'credentials in url');
    await rejects(fetchPublicFile('http://example.com:8080/a.png'), /port/, 'odd port');
    await rejects(fetchPublicFile('http://127.0.0.1/a.png'), /not allowed/, 'loopback literal');
    await rejects(fetchPublicFile('http://[::1]/a.png'), /not allowed/, 'ipv6 loopback literal');
    await rejects(fetchPublicFile('http://[::ffff:10.0.0.1]/a.png'), /not allowed/, 'ipv4-mapped literal');
    await rejects(fetchPublicFile('http://2130706433/a.png'), /not allowed/, 'decimal ip form');
    await rejects(fetchPublicFile('http://0x7f.1/a.png'), /not allowed/, 'hex ip form');

    console.log('safeFetch tests passed');
  } finally {
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
