'use strict';

// Fetch a file from a URL a person typed, without letting that person reach our own network.
//
// What it guards against (Graphics "import by URL" is the first user):
//  - a host that is, or resolves to, a private / loopback / link-local / cloud-metadata address, including IPv6 forms
//    (::1, fc00::/7, fe80::/10, IPv4-mapped ::ffff:10.0.0.1, NAT64 and 6to4 wrappers);
//  - DNS rebinding: the name is resolved ONCE, every address must be public, and the connection is made to that exact
//    address (the original host name is kept only for the Host header and the TLS certificate check);
//  - redirects to somewhere internal: every hop goes through the same checks, at most 5 hops;
//  - big or slow responses: the body is streamed and cut off at maxBytes, with an overall timeout;
//  - odd ports: only 80 and 443.
//
// Errors thrown here carry `.status = 400` and a message that is safe to show the person.

const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');

const fail = (message) => Object.assign(new Error(message), { status: 400 });

function v4Private(a, b, c) {
  if (a === 0 || a === 10 || a === 127) return true; // this network, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true; // IETF protocol assignments
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

/** True only for an address that is on the public internet. Anything unparseable is treated as not public. */
function isPublicIp(ip) {
  const text = String(ip || '').trim().toLowerCase();
  const kind = net.isIP(text);
  if (kind === 4) {
    const [a, b, c] = text.split('.').map(Number);
    return !v4Private(a, b, c);
  }
  if (kind !== 6) return false;

  // Expand to 8 groups so prefixes can be compared reliably.
  let head = text.split('%')[0];
  const lastColon = head.lastIndexOf(':');
  if (head.slice(lastColon + 1).includes('.')) {
    const v4 = head.slice(lastColon + 1).split('.').map(Number);
    head = `${head.slice(0, lastColon + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  }
  const [left, right] = head.split('::');
  const l = left ? left.split(':') : [];
  const r = right !== undefined && right ? right.split(':') : [];
  const groups = right === undefined ? l : [...l, ...Array(Math.max(0, 8 - l.length - r.length)).fill('0'), ...r];
  if (groups.length !== 8) return false;
  const g = groups.map((x) => parseInt(x || '0', 16));
  if (g.some((x) => Number.isNaN(x))) return false;

  const embedded = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255];
  if (g.every((x) => x === 0)) return false; // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return false; // ::1
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return !v4Private(...embedded(g[6], g[7]).slice(0, 3)); // ::ffff:a.b.c.d
  if (g.slice(0, 6).every((x) => x === 0)) return false; // ::a.b.c.d (deprecated IPv4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b) return !v4Private(...embedded(g[6], g[7]).slice(0, 3)); // NAT64 64:ff9b::/96
  if (g[0] === 0x2002) return !v4Private(...embedded(g[1], g[2]).slice(0, 3)); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return false; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  return true;
}

const defaultResolve = (host) => new Promise((resolve, reject) => {
  dns.lookup(host, { all: true, verbatim: true }, (err, list) => (err ? reject(err) : resolve(list.map((x) => x.address))));
});

/** Resolve a host name and return one address, refusing if ANY address it resolves to is not public. */
async function resolvePublicAddress(host, { resolve = defaultResolve, isAllowedIp = isPublicIp } = {}) {
  const bare = host.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(bare)) addresses = [bare];
  else {
    try { addresses = await resolve(bare); } catch { throw Object.assign(fail('Could not find that web address'), { reason: 'dns' }); }
  }
  if (!addresses?.length) throw Object.assign(fail('Could not find that web address'), { reason: 'dns' });
  if (!addresses.every((a) => isAllowedIp(a))) throw Object.assign(fail('That address is not allowed'), { reason: 'private' });
  return addresses[0];
}

/**
 * Resolve a host name for a fetch and make sure it is safe: every address it resolves to must be public. Resolves with the checked
 * address (connect to THAT, see pinnedLookup). Rejects with 'DNS lookup failed' or 'URL resolves to a private or internal address'.
 */
function checkSsrf(hostname, deps) {
  return resolvePublicAddress(hostname, deps).catch((err) => {
    if (err.reason === 'dns') throw new Error('DNS lookup failed');
    if (err.reason === 'private') throw new Error('URL resolves to a private or internal address');
    throw err;
  });
}

/**
 * A `lookup` option for http(s).request that always answers with an address we already checked, so the connection cannot be
 * redirected by a second DNS answer (DNS rebinding). The request keeps its host name for the Host header and the TLS certificate.
 */
function pinnedLookup(address) {
  const family = net.isIP(address);
  return (_host, opts, cb) => (opts && opts.all ? cb(null, [{ address, family }]) : cb(null, address, family));
}

function requestOnce(url, address, { timeoutMs, maxBytes, accept }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { 'user-agent': 'CuramVault/1.0', accept },
      timeout: timeoutMs,
      // Connect to the address we already checked, not whatever the name resolves to a second time.
      lookup: pinnedLookup(address),
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url).toString() });
      }
      if (res.statusCode >= 400) {
        res.resume();
        return reject(fail(`Could not fetch the file (HTTP ${res.statusCode})`));
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        req.destroy();
        return reject(fail(`File is too large (max ${Math.round(maxBytes / 1048576)}MB)`));
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          req.destroy();
          reject(fail(`File is too large (max ${Math.round(maxBytes / 1048576)}MB)`));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || '') }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(fail('Fetching the file timed out')); });
    req.on('error', (err) => reject(err.status ? err : fail('Could not fetch the file')));
    req.end();
  });
}

/**
 * Download a public http(s) file. Resolves { buffer, contentType, finalUrl }.
 * `deps.resolve`, `deps.isAllowedIp` and `deps.ports` exist so tests can run without the network; production uses the defaults.
 */
async function fetchPublicFile(rawUrl, { maxBytes = 25 * 1024 * 1024, timeoutMs = 15000, maxRedirects = 5, accept = '*/*', deps = {} } = {}) {
  let url;
  try { url = new URL(String(rawUrl || '').trim()); } catch { throw fail('Enter a valid URL'); }
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!/^https?:$/.test(url.protocol)) throw fail('Only http(s) URLs are allowed');
    if (url.username || url.password) throw fail('Web addresses with a login in them are not allowed');
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    if (!(deps.ports || ['80', '443']).includes(port)) throw fail('Only the standard web ports (80 and 443) are allowed');
    // eslint-disable-next-line no-await-in-loop
    const address = await resolvePublicAddress(url.hostname, deps);
    // eslint-disable-next-line no-await-in-loop
    const result = await requestOnce(url, address, { timeoutMs, maxBytes, accept });
    if (!result.redirect) return { buffer: result.buffer, contentType: result.contentType, finalUrl: url.toString() };
    try { url = new URL(result.redirect); } catch { throw fail('The address redirected somewhere invalid'); }
  }
  throw fail('Too many redirects');
}

module.exports = { isPublicIp, resolvePublicAddress, checkSsrf, pinnedLookup, fetchPublicFile };
