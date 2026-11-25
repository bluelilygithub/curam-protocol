'use strict';

// DNS Lookup: who the domain is registered through (registrar) and who runs the computer its address points at (host). Both come from
// RDAP via rdap.org (no key): the domain's record names the registrar, the IP address's network record names the host. The registrar half
// is Business Profiler's own RDAP + WHOIS code. Never throws: a failed half comes back as { error }. See docs/dns-lookup.md.

const { lookupRegistration, vcardValue } = require('../bip/rdap');
const { fetchPublicJson } = require('../bip/http');
const { queryType, reverseLookup, makeResolver } = require('./lookup');

// www.shop.example.com.au -> example.com.au. Good enough for RDAP: a few country codes put a word like "com" before the country.
const SECOND_LEVEL = /^(com|net|org|edu|gov|asn|id|co|ac)$/;
function registrableDomain(name) {
  const parts = String(name).split('.');
  const keep = parts.length > 2 && SECOND_LEVEL.test(parts[parts.length - 2]) && parts[parts.length - 1].length === 2 ? 3 : 2;
  return parts.slice(-keep).join('.');
}

// A proxy or CDN answers for the site, so the real server behind it cannot be seen from DNS.
const PROXIES = /cloudflare|fastly|akamai|cloudfront|incapsula|imperva|sucuri|stackpath/i;

function parseIpRdap(json, ip) {
  const entities = Array.isArray(json?.entities) ? json.entities : [];
  const withRole = (role) => entities.find((e) => (Array.isArray(e.roles) ? e.roles : []).includes(role));
  const remark = (Array.isArray(json?.remarks) ? json.remarks : []).flatMap((r) => r.description || [])[0] || null;
  const organisation = vcardValue(withRole('registrant'), 'fn') || remark || vcardValue(withRole('administrative'), 'fn') || null;
  const network = json?.name || null;
  // Where the network's owner is registered (RIPE/APNIC give a code; ARIN only an address whose last line is the country). This is the
  // company's country, not the server's: a Microsoft network registered in the US can sit in Sydney. Only a fallback for `location`.
  const label = withRole('registrant')?.vcardArray?.[1]?.find((r) => r[0] === 'adr')?.[1]?.label;
  const registeredIn = countryName(json?.country) || (label ? String(label).trim().split(/\n/).pop().trim() : null) || null;
  return { ip, organisation, network, registeredIn, proxy: PROXIES.test(`${organisation || ''} ${network || ''}`) };
}

const REGIONS = new Intl.DisplayNames(['en'], { type: 'region' });
function countryName(code) {
  if (!/^[A-Z]{2}$/i.test(String(code || ''))) return null;
  try { return REGIONS.of(code.toUpperCase()); } catch { return null; }
}

// Where the server physically is, from ipinfo.io (free without a key, up to 50,000 a month). null when it cannot say.
function parseIpinfo(json) {
  const country = countryName(json?.country);
  if (!country) return null;
  return { country, region: json.region || null, city: json.city || null };
}

async function hostOf(resolverKey, ip, deps) {
  try {
    const fetchJson = deps.fetchPublicJson || fetchPublicJson;
    const [{ json }, ptr, place] = await Promise.all([
      fetchJson(`https://rdap.org/ip/${encodeURIComponent(ip)}`, { module: 'dns-lookup-rdap', timeoutMs: 8000 }),
      (deps.reverseLookup || reverseLookup)(resolverKey, ip),
      fetchJson(`https://ipinfo.io/${encodeURIComponent(ip)}/json`, { module: 'dns-lookup-ipinfo', timeoutMs: 6000 }).then((r) => parseIpinfo(r.json)).catch(() => null),
    ]);
    return { ...parseIpRdap(json, ip), location: place, reverseName: ptr?.records?.[0]?.value || null };
  } catch (err) {
    return { ip, error: `Could not find who runs ${ip} (${err.message}).` };
  }
}

async function registrarOf(name, deps) {
  const domain = registrableDomain(name);
  const r = await (deps.lookupRegistration || lookupRegistration)(domain, deps);
  if (!r.registrar && !r.registrationDate && !r.expiryDate) return { domain, error: r.error ? `The registry did not answer (${r.error}).` : 'The registry gave no registrar.' };
  return { domain, name: r.registrar || null, registered: r.registrationDate || null, expires: r.expiryDate || null, source: r.lookupSource };
}

/** { hosting, registrar } for a name, or { hosting } for an IP address. hosting is null when the name has no address. */
async function whoHosts(resolverKey, input, deps = {}) {
  if (input.ip) return { hosting: await hostOf(resolverKey, input.ip, deps), registrar: null };
  const resolver = deps.resolver || makeResolver(resolverKey);
  const [registrar, address] = await Promise.all([
    registrarOf(input.name, deps),
    (async () => {
      const a = await queryType(resolver, input.name, 'A');
      if (a.records.length) return a.records[0].value;
      const aaaa = await queryType(resolver, input.name, 'AAAA');
      return aaaa.records[0]?.value || null;
    })(),
  ]);
  return { hosting: address ? await hostOf(resolverKey, address, deps) : null, registrar };
}

module.exports = { whoHosts, registrableDomain, parseIpRdap, parseIpinfo };
