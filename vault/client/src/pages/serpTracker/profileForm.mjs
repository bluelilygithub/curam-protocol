// SERP Tracker: turns the saved site profile into the page's text boxes and back. Pure, so `node profileForm.test.mjs` checks it.
// The server validates again (server/services/serpTracker/siteProfile.js); this only splits and joins text.

const FALLBACK = { locationName: 'Australia', languageCode: 'en', searchDomain: 'google.com.au', devices: ['desktop', 'mobile'], serpDepth: 100, timezone: 'Australia/Brisbane' };

const lines = (text) => String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const splitBar = (line) => {
  const i = line.indexOf('|');
  return i === -1 ? [line.trim(), ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
};

export function profileToForm(profile, defaults = FALLBACK) {
  const d = { ...FALLBACK, ...(defaults || {}) };
  const p = profile || {};
  return {
    name: p.name || '',
    domain: p.domain || '',
    brandTermsText: (p.brandTerms || []).join('\n'),
    keywordsText: (p.keywords || []).map((k) => (k.targetUrl ? `${k.term} | ${k.targetUrl}` : k.term)).join('\n'),
    competitorsText: (p.competitors || []).map((c) => (c.pages && c.pages.length ? `${c.domain} | ${c.pages.join(', ')}` : c.domain)).join('\n'),
    healthText: (p.healthCheckUrls || []).join('\n'),
    locationName: p.locationName || d.locationName,
    languageCode: p.languageCode || d.languageCode,
    searchDomain: p.searchDomain || d.searchDomain,
    devices: p.devices && p.devices.length ? p.devices : d.devices.slice(),
    serpDepth: p.serpDepth || d.serpDepth,
    timezone: p.timezone || d.timezone,
  };
}

export function formToProfile(form) {
  return {
    name: form.name,
    domain: form.domain,
    brandTerms: lines(form.brandTermsText),
    keywords: lines(form.keywordsText).map((l) => {
      const [term, targetUrl] = splitBar(l);
      return targetUrl ? { term, targetUrl } : { term };
    }),
    competitors: lines(form.competitorsText).map((l) => {
      const [domain, pages] = splitBar(l);
      return { domain, pages: pages ? pages.split(',').map((p) => p.trim()).filter(Boolean) : [] };
    }),
    healthCheckUrls: lines(form.healthText),
    locationName: form.locationName,
    languageCode: form.languageCode,
    searchDomain: form.searchDomain,
    devices: form.devices,
    serpDepth: Number(form.serpDepth),
    timezone: form.timezone,
  };
}
