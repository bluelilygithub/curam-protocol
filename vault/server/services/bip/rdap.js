'use strict';

// BIP stage 1: registration details from rdap.org (no key), with a port-43 WHOIS fallback when the registry redacts everything.
// RDAP answers are JSON but the vcard layout varies between registries, so the parsers below are deliberately forgiving.

const { fetchPublicJson } = require('./http');
const whois = require('./whoisFallback');
const { cleanText, dateISO, yearsSince } = require('./normalise');

function vcardValue(card, field) {
  const rows = Array.isArray(card?.vcardArray?.[1]) ? card.vcardArray[1] : [];
  const row = rows.find((r) => Array.isArray(r) && String(r[0]).toLowerCase() === field);
  return row ? row[3] : null;
}

function vcardAddress(card) {
  const value = vcardValue(card, 'adr');
  if (!value) return null;
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return cleanText(parts.filter(Boolean).join(', '), 250) || null;
}

function parseRdap(json, domain, source = 'RDAP (rdap.org)') {
  const entities = Array.isArray(json?.entities) ? json.entities : [];
  const ldh = cleanText(json?.ldhName || domain, 253);
  const events = Array.isArray(json?.events) ? json.events : [];
  const eventDate = (action) => {
    const found = events.find((e) => String(e.eventAction).toLowerCase() === action);
    return dateISO(found?.eventDate);
  };
  const withRole = (role) => entities.filter((e) => (Array.isArray(e.roles) ? e.roles : []).some((r) => String(r).toLowerCase() === role));
  const registrant = withRole('registrant')[0] || null;
  const registrar = withRole('registrar')[0] || null;
  const registrationDate = eventDate('registration') || eventDate('creation');
  const result = {
    domain: ldh,
    registrantName: cleanText(vcardValue(registrant, 'fn'), 200),
    organisation: cleanText(vcardValue(registrant, 'org'), 200),
    address: vcardAddress(registrant),
    registrationDate,
    expiryDate: eventDate('expiration') || eventDate('expiry'),
    registrar: cleanText(vcardValue(registrar, 'fn'), 200),
    status: Array.isArray(json?.status) ? json.status.slice(0, 20) : [],
    lookupSource: source,
    redacted: false,
  };
  result.domainAgeYears = yearsSince(result.registrationDate);
  result.redacted = !result.registrantName && !result.organisation && !result.address;
  return result;
}

/** Stage 1 registration lookup. Never throws: a failed registry becomes a source row with an error, not a failed profile. */
async function lookupRegistration(domain, deps = {}) {
  const url = `https://rdap.org/domain/${encodeURIComponent(domain)}`;
  try {
    const { json, finalUrl } = deps.fetchPublicJson
      ? await deps.fetchPublicJson(url)
      : await fetchPublicJson(url, { module: 'registration' });
    const parsed = parseRdap(json, domain);
    if (!parsed.redacted || parsed.registrationDate || parsed.expiryDate) return { ...parsed, raw: json, lookupUrl: finalUrl || url };
    const fallback = await whois.lookup(domain, deps);
    return {
      ...parsed,
      registrantName: parsed.registrantName || fallback.registrantName,
      organisation: parsed.organisation || fallback.organisation,
      address: parsed.address || fallback.address,
      registrationDate: parsed.registrationDate || dateISO(fallback.registrationDate),
      expiryDate: parsed.expiryDate || dateISO(fallback.expiryDate),
      registrar: parsed.registrar || fallback.registrar,
      lookupSource: `${parsed.lookupSource} + ${fallback.lookupSource}`,
      redacted: !(parsed.registrantName || fallback.registrantName) && !(parsed.organisation || fallback.organisation),
      raw: { rdap: json, whois: fallback.raw },
      lookupUrl: finalUrl || url,
    };
  } catch (err) {
    try {
      const fallback = await whois.lookup(domain, deps);
      return {
        domain,
        registrantName: fallback.registrantName,
        organisation: fallback.organisation,
        address: fallback.address,
        registrationDate: dateISO(fallback.registrationDate),
        expiryDate: dateISO(fallback.expiryDate),
        registrar: fallback.registrar,
        status: [],
        lookupSource: fallback.lookupSource,
        redacted: !fallback.registrantName && !fallback.organisation,
        domainAgeYears: yearsSince(fallback.registrationDate),
        raw: { whois: fallback.raw },
        lookupUrl: null,
        error: err.message,
      };
    } catch (fallbackErr) {
      return { domain, status: [], lookupSource: 'unavailable', redacted: true, domainAgeYears: null, raw: null, error: `${err.message}; WHOIS fallback: ${fallbackErr.message}` };
    }
  }
}

module.exports = { parseRdap, lookupRegistration, vcardValue, vcardAddress };
