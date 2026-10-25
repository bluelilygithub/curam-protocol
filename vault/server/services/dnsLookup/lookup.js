'use strict';

// DNS Lookup: ask a public resolver (Cloudflare or Google) what a name points at. Nothing is stored and nothing is fetched from the name
// itself: only DNS questions go out, to the resolver. See docs/dns-lookup.md.

const dns = require('dns');
const net = require('net');
const url = require('url');

const RESOLVERS = {
  cloudflare: { label: 'Cloudflare (1.1.1.1)', servers: ['1.1.1.1', '1.0.0.1'] },
  google: { label: 'Google (8.8.8.8)', servers: ['8.8.8.8', '8.8.4.4'] },
};
const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA'];
const TIMEOUT_MS = 4000;

// Turn what the person typed (a name, a web address, an IP) into a clean name or IP. Returns { name } | { ip } | { error }.
function normalizeInput(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return { error: 'Type a domain name or an IP address.' };
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');      // https://
  s = s.split(/[/?#]/)[0];                            // path, query
  s = s.replace(/^[^@]*@/, '');                       // user@ (so an email address works too)
  if (net.isIP(s)) return { ip: s };
  const bracketed = s.match(/^\[([0-9a-f:.]+)\](:\d+)?$/);
  if (bracketed && net.isIP(bracketed[1])) return { ip: bracketed[1] };
  s = s.replace(/:\d+$/, '').replace(/\.$/, '');      // :443 and the trailing dot
  if (net.isIP(s)) return { ip: s };
  const ascii = url.domainToASCII(s);
  if (!ascii) return { error: 'That does not look like a domain name.' };
  if (ascii.length > 253) return { error: 'That name is too long.' };
  const labels = ascii.split('.');
  const ok = labels.every((l) => l.length >= 1 && l.length <= 63 && /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/.test(l));
  if (!ok || labels.length < 2) return { error: 'That does not look like a domain name (for example example.com).' };
  return { name: ascii };
}

function makeResolver(key) {
  const def = RESOLVERS[key];
  if (!def) return null;
  const r = new dns.promises.Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  r.setServers(def.servers);
  return r;
}

// One record type -> { type, records: [{ value, ttl?, priority? }], error? }. "No such record" is an empty list, not an error.
async function queryType(resolver, name, type) {
  try {
    let records = [];
    if (type === 'A' || type === 'AAAA') {
      const rows = await (type === 'A' ? resolver.resolve4(name, { ttl: true }) : resolver.resolve6(name, { ttl: true }));
      records = rows.map((r) => ({ value: r.address, ttl: r.ttl }));
    } else if (type === 'CNAME') {
      records = (await resolver.resolveCname(name)).map((v) => ({ value: v }));
    } else if (type === 'NS') {
      records = (await resolver.resolveNs(name)).map((v) => ({ value: v }));
    } else if (type === 'MX') {
      records = (await resolver.resolveMx(name)).sort((a, b) => a.priority - b.priority).map((r) => ({ value: r.exchange, priority: r.priority }));
    } else if (type === 'TXT') {
      records = (await resolver.resolveTxt(name)).map((chunks) => ({ value: chunks.join('') }));
    } else if (type === 'SOA') {
      const r = await resolver.resolveSoa(name);
      records = [{ value: `${r.nsname} ${r.hostmaster} serial ${r.serial}, refresh ${r.refresh}, retry ${r.retry}, expire ${r.expire}, minimum ${r.minttl}` }];
    } else if (type === 'CAA') {
      records = (await resolver.resolveCaa(name)).map((r) => {
        const tag = ['issue', 'issuewild', 'iodef'].find((t) => r[t] !== undefined);
        return { value: tag ? `${tag} ${r[tag]}` : JSON.stringify(r) };
      });
    }
    return { type, records };
  } catch (err) {
    if (['ENODATA', 'ENOTFOUND', 'NODATA', 'NOTFOUND'].includes(err.code)) return { type, records: [] };
    return { type, records: [], error: describeError(err) };
  }
}

function describeError(err) {
  switch (err.code) {
    case 'ETIMEOUT': return 'The resolver did not answer in time.';
    case 'ECONNREFUSED': return 'The resolver refused the question.';
    case 'ESERVFAIL': return 'The name servers for this domain failed to answer (SERVFAIL).';
    case 'EREFUSED': return 'The resolver refused the question.';
    case 'EBADNAME': return 'That name is not valid.';
    default: return `Lookup failed (${err.code || 'error'}).`;
  }
}

async function lookupRecords(resolverKey, name, types) {
  const resolver = makeResolver(resolverKey);
  const wanted = (Array.isArray(types) && types.length ? types : TYPES).filter((t) => TYPES.includes(t));
  const results = await Promise.all(wanted.map((t) => queryType(resolver, name, t)));
  return results;
}

async function reverseLookup(resolverKey, ip) {
  const resolver = makeResolver(resolverKey);
  try {
    const names = await resolver.reverse(ip);
    return { type: 'PTR', records: names.map((v) => ({ value: v })) };
  } catch (err) {
    if (['ENODATA', 'ENOTFOUND'].includes(err.code)) return { type: 'PTR', records: [] };
    return { type: 'PTR', records: [], error: describeError(err) };
  }
}

// For the email check: MX and TXT of the name, and TXT of _dmarc.<name>.
async function lookupEmailParts(resolverKey, name) {
  const resolver = makeResolver(resolverKey);
  const [mx, txt, dmarc] = await Promise.all([
    queryType(resolver, name, 'MX'),
    queryType(resolver, name, 'TXT'),
    queryType(resolver, `_dmarc.${name}`, 'TXT'),
  ]);
  return { mx, txt, dmarc };
}

module.exports = { RESOLVERS, TYPES, normalizeInput, lookupRecords, reverseLookup, lookupEmailParts, queryType };
