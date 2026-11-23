'use strict';

// node --test server/services/bip/bip.test.js
// Business Profiler unit tests. Every external call is injected: no network, DNS, port 43 or real API is touched.

const test = require('node:test');
const assert = require('node:assert/strict');

const normalise = require('./normalise');
const http = require('./http');
const whois = require('./whoisFallback');
const rdap = require('./rdap');
const website = require('./website');
const dns = require('./dns');
const techStack = require('./techStack');
const sources = require('./sources');
const reconcile = require('./reconcile');
const { buildCards } = require('./cards');

const DOMAIN = 'saleslogs.com.au';
const ABN = '69 161 409 132';
const ABN_DIGITS = '69161409132';

// ── shared, deliberately small fixtures ─────────────────────────────────────────────────

const caseStudyRdap = {
  objectClassName: 'domain',
  handle: 'SLOG-AU',
  ldhName: DOMAIN,
  unicodeName: DOMAIN,
  status: ['active', 'ok', 'clientTransferProhibited'],
  events: [
    { eventAction: 'registration', eventDate: '2004-08-20T00:00:00Z' },
    { eventAction: 'expiration', eventDate: '2030-08-20T00:00:00Z' },
    { eventAction: 'last changed', eventDate: '2025-01-02T00:00:00Z' },
  ],
  entities: [
    {
      objectClassName: 'entity',
      handle: 'SLOG-PTY-LTD',
      roles: ['registrant'],
      vcardArray: ['vcard', [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'SalesLogs Pty Limited'],
        ['org', {}, 'text', 'SalesLogs Pty Limited'],
        ['adr', {}, 'text', ['', '', 'Level 1', '100 Exhibition Street', 'Melbourne', 'VIC', '3000', 'Australia']],
        ['email', {}, 'text', 'hello@saleslogs.com.au'],
      ]],
    },
    {
      objectClassName: 'entity',
      handle: 'GODADDY-1',
      roles: ['registrar'],
      vcardArray: ['vcard', [
        ['version', {}, 'text', '4.0'],
        ['fn', {}, 'text', 'GoDaddy.com, LLC'],
      ]],
    },
  ],
  remarks: [{ title: 'ABN', description: [`Australian Business Number: ${ABN}`] }],
};

const redactedRdap = {
  objectClassName: 'domain',
  ldhName: DOMAIN,
  status: ['clientTransferProhibited'],
  events: [],
  entities: [{
    objectClassName: 'entity',
    roles: ['registrant'],
    vcardArray: ['vcard', [['version', {}, 'text', '4.0']]],
    remarks: [{ title: 'REDACTED', description: ['Registrant details are not disclosed.'] }],
  }],
};

const whoisText = [
  'Domain Name: SALESLOGS.COM.AU',
  'Registrar: GoDaddy.com, LLC',
  'Creation Date: 2004-08-20T00:00:00Z',
  'Registry Expiry Date: 2030-08-20T00:00:00Z',
  'Registrant Name: SalesLogs Pty Limited',
  'Registrant Organisation: SalesLogs Pty Limited',
  'Registrant Street: 100 Exhibition Street',
  'Registrant City: Melbourne',
  'Registrant State: VIC',
  'Registrant Postcode: 3000',
  'Registrant Country: Australia',
  '',
].join('\r\n');

const HOME_HTML = `<!doctype html><html><head>
<title>SalesLogs — automotive SaaS</title>
<meta name="description" content="Automotive SaaS for Australian workshops">
<script src="https://www.google-analytics.com/analytics.js"></script>
<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>
<script src="https://connect.facebook.net/en_US/fbevents.js"></script>
</head><body>
<a href="https://www.facebook.com/saleslogs">Facebook</a>
<a href="https://www.instagram.com/saleslogs/">Instagram</a>
<a href="https://x.com/saleslogs">X</a>
<a href="https://www.linkedin.com/company/saleslogs">LinkedIn</a>
<a href="https://www.youtube.com/@saleslogs">YouTube</a>
<p>Automotive SaaS for automotive workshops across Australia.</p>
</body></html>`;

const ABOUT_HTML = `<html><head><title>About SalesLogs</title></head><body>
<p>Our team of 13 people builds automotive SaaS for automotive workshops.</p>
<p>Founded in 2004, SalesLogs helps Australian workshops with cloud software.</p>
<p>Jane Smith — CEO</p><p>John Doe — Founder</p>
</body></html>`;

const CONTACT_HTML = `<html><head><title>Contact SalesLogs</title></head><body>
<p>Call us on +61 3 9000 1234.</p>
<p>Email hello@saleslogs.com.au.</p>
<p>Level 1, 100 Exhibition Street, Melbourne, VIC 3000, Australia</p>
</body></html>`;

const SITEMAP_HTML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://saleslogs.com.au/</loc></url>
<url><loc>https://saleslogs.com.au/about</loc></url>
<url><loc>https://saleslogs.com.au/contact</loc></url>
</urlset>`;

const PAGES = {
  [`https://${DOMAIN}/`]: {
    html: HOME_HTML,
    text: 'SalesLogs — automotive SaaS. Automotive SaaS for automotive workshops across Australia.',
  },
  [`https://${DOMAIN}/about`]: {
    html: ABOUT_HTML,
    text: 'Our team of 13 people builds automotive SaaS for automotive workshops.\nFounded in 2004, SalesLogs helps Australian workshops with cloud software.\nJane Smith — CEO\nJohn Doe — Founder',
  },
  [`https://${DOMAIN}/contact`]: {
    html: CONTACT_HTML,
    text: 'Call us on +61 3 9000 1234.\nEmail hello@saleslogs.com.au.\nLevel 1, 100 Exhibition Street, Melbourne, VIC 3000, Australia',
  },
  [`https://${DOMAIN}/sitemap.xml`]: { html: SITEMAP_HTML, text: 'Sitemap: 3 URLs' },
};

function websiteDeps() {
  const seen = [];
  return {
    seen,
    fetchHtml: async (url) => {
      seen.push(url);
      const page = PAGES[url];
      if (!page) throw new Error(`Unexpected website fetch: ${url}`);
      return { statusCode: 200, body: page.html, finalUrl: url };
    },
    normaliseHttpUrl: (url) => url,
    htmlToText: (html) => Object.values(PAGES).find((p) => p.html === html)?.text || String(html),
  };
}

function dnsLib() {
  return {
    normalizeInput: (value) => ({ name: value }),
    lookupRecords: async (resolver, name) => {
      assert.equal(resolver, 'cloudflare');
      assert.equal(name, DOMAIN);
      return [
        { type: 'A', records: [{ value: '203.0.113.10' }] },
        { type: 'MX', records: [{ value: 'aspmx.l.google.com' }] },
        { type: 'NS', records: [{ value: 'ns.cloudflare.com' }] },
        { type: 'TXT', records: [{ value: 'v=spf1 include:hubspot.com ~all' }, { value: 'google-site-verification=abc123' }] },
        { type: 'CNAME', records: [{ value: 'www.saleslogs.com.au.cdn.cloudflare.net' }] },
      ];
    },
    lookupEmailParts: async () => ({ dmarc: { records: [{ value: 'v=DMARC1; p=none' }] } }),
  };
}

const ENV_KEYS = ['ABR_GUID', 'GOOGLE_PLACES_API_KEY', 'GOOGLE_SEARCH_API_KEY', 'GOOGLE_SEARCH_CX'];

function snapshotEnv() {
  return Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
}

function restoreEnv(saved) {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

function noNetworkDeps() {
  return {
    fetch: () => { throw new Error('Real HTTP fetch is forbidden in this test.'); },
    fetchPublicFile: () => { throw new Error('Real public fetch is forbidden in this test.'); },
    query: () => { throw new Error('Real port-43 WHOIS is forbidden in this test.'); },
  };
}

// ── normalise.js ─────────────────────────────────────────────────────────────────────────

test('normalise.domain() strips schemes, www, paths, ports, credentials and emails', () => {
  assert.equal(normalise.domain('https://www.SalesLogs.com.au/about?x=1'), DOMAIN);
  assert.equal(normalise.domain('http://SALESLOGS.com.au:8080/contact'), DOMAIN);
  assert.equal(normalise.domain('mailto:hello@www.saleslogs.com.au'), DOMAIN);
  assert.equal(normalise.domain('jane@www.saleslogs.com.au'), DOMAIN);
  assert.equal(normalise.domain('www.saleslogs.com.au.'), DOMAIN);
  assert.equal(normalise.domain('192.168.0.1'), null);
  assert.equal(normalise.domain('https://127.0.0.1/'), null);
  assert.equal(normalise.domain('localhost'), null);
  assert.equal(normalise.domain(''), null);
});

test('normalise ABN, date and yearsSince helpers use deterministic values', () => {
  assert.equal(normalise.abnDigits(`ABN ${ABN}`), ABN_DIGITS);
  assert.equal(normalise.abnPretty(ABN_DIGITS), ABN);
  assert.equal(normalise.abnPretty(ABN), ABN);
  assert.equal(normalise.abnDigits('not an abn'), null);
  assert.equal(normalise.dateISO('2004/08/20'), '2004-08-20');
  assert.equal(normalise.dateISO('2004-08-20T00:00:00Z'), '2004-08-20');
  assert.equal(normalise.dateISO('not a date'), null);
  assert.equal(normalise.yearsSince('2004-06-24', new Date('2026-06-24T00:00:00Z')), 22);
  assert.equal(normalise.yearsSince('2024-01-01', new Date('2026-01-01T00:00:00Z')), 2);
  assert.equal(normalise.yearsSince('2030-01-01', new Date('2026-01-01T00:00:00Z')), null);
});

// ── http.js (injected fetch / sleep only) ──────────────────────────────────────────────

test('http.parseJsonp() reads plain JSON, JSONP and rejects junk', () => {
  assert.deepStrictEqual(http.parseJsonp('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(http.parseJsonp('cb({"a":1});'), { a: 1 });
  assert.equal(http.parseJsonp('not json'), null);
  assert.equal(http.parseJsonp(''), null);
});

test('http.fetchJson() retries 5xx with injected fetch and injected sleep', async () => {
  const calls = [];
  const sleeps = [];
  const deps = {
    fetch: async (url, opts) => {
      calls.push({ url, method: opts.method });
      return calls.length === 1
        ? { status: 503, text: async () => 'busy' }
        : { status: 200, text: async () => '{"entityName":"SalesLogs Pty Limited"}' };
    },
    // http.js calls deps.sleep like setTimeout: (resolve, ms), not (ms).
    sleep: (resolve, ms) => { sleeps.push(ms); resolve(); },
  };
  const json = await http.fetchJson('https://api.test/entity', { retries: 1, minGapMs: 0, deps });
  assert.deepStrictEqual(json, { entityName: 'SalesLogs Pty Limited' });
  assert.equal(calls.length, 2);
  assert.deepStrictEqual(sleeps, [250]);
  assert.equal(calls[0].method, 'GET');
});

test('http.fetchJson() does not retry a 4xx status', async () => {
  let calls = 0;
  const deps = { fetch: async () => { calls += 1; return { status: 400, text: async () => 'bad' }; }, sleep: (resolve) => resolve() };
  await assert.rejects(http.fetchJson('https://api.test/bad', { retries: 2, minGapMs: 0, deps }), (err) => err.status === 400 && /HTTP 400/.test(err.message));
  assert.equal(calls, 1, 'a client error is not retried');
});

test('http.fetchPublicJson() uses the injected safe-fetch result', async () => {
  let calledWith = null;
  const deps = {
    fetchPublicFile: async (url, opts) => {
      calledWith = { url, opts };
      return { buffer: Buffer.from('{"domain":"saleslogs.com.au"}'), finalUrl: 'https://rdap.org/domain/saleslogs.com.au' };
    },
    sleep: (resolve) => resolve(),
  };
  const out = await http.fetchPublicJson('https://rdap.org/domain/saleslogs.com.au', { module: 'bip-test-public-json', deps });
  assert.deepStrictEqual(out.json, { domain: DOMAIN });
  assert.equal(out.finalUrl, 'https://rdap.org/domain/saleslogs.com.au');
  assert.equal(calledWith.opts.accept, 'application/json');
});

test('http.limit() spaces calls and delegates the wait to deps.sleep', async () => {
  const waits = [];
  const deps = { sleep: (resolve, ms) => { waits.push(ms); resolve(); } };
  const order = [];
  const first = http.limit('bip-test-limit', 10000, async () => { order.push(1); }, deps);
  const second = http.limit('bip-test-limit', 10000, async () => { order.push(2); }, deps);
  await Promise.all([first, second]);
  assert.deepStrictEqual(order, [1, 2]);
  assert.ok(waits.length >= 1 && waits[0] > 0, 'the second call waits for the rate limit');
});

// ── whoisFallback.js ────────────────────────────────────────────────────────────────────

test('whoisFallback.serverFor() picks the au registry without connecting', () => {
  assert.equal(whois.serverFor(DOMAIN), 'whois.auda.org.au');
  assert.equal(whois.serverFor('example.com'), 'whois.verisign-grs.com');
  assert.equal(whois.serverFor('example.invalidtld'), null);
});

test('whoisFallback.parseWhois() reads registrant, dates and registrar', () => {
  const parsed = whois.parseWhois(whoisText);
  assert.equal(parsed.registrantName, 'SalesLogs Pty Limited');
  assert.equal(parsed.organisation, 'SalesLogs Pty Limited');
  assert.equal(parsed.registrationDate, '2004-08-20T00:00:00Z');
  assert.equal(parsed.expiryDate, '2030-08-20T00:00:00Z');
  assert.equal(parsed.registrar, 'GoDaddy.com, LLC');
  assert.equal(normalise.dateISO(parsed.registrationDate), '2004-08-20');
});

test('whoisFallback.parseWhois() collects the registrant address lines', () => {
  const parsed = whois.parseWhois(whoisText);
  assert.equal(parsed.address, '100 Exhibition Street, Melbourne, VIC, 3000, Australia');
});

test('whoisFallback.lookup() calls only the injected query function', async () => {
  const calls = [];
  const deps = {
    query: async (server, domain) => {
      calls.push({ server, domain });
      return whoisText;
    },
  };
  const out = await whois.lookup(DOMAIN, deps);
  assert.deepStrictEqual(calls, [{ server: 'whois.auda.org.au', domain: DOMAIN }]);
  assert.equal(out.organisation, 'SalesLogs Pty Limited');
  assert.equal(out.lookupSource, 'WHOIS (whois.auda.org.au)');
  assert.equal(out.raw, whoisText);
});

// ── rdap.js ─────────────────────────────────────────────────────────────────────────────

test('rdap.parseRdap() reads the case-study registrant, events and registrar', () => {
  const parsed = rdap.parseRdap(caseStudyRdap, DOMAIN);
  assert.equal(parsed.domain, DOMAIN);
  assert.equal(parsed.registrantName, 'SalesLogs Pty Limited');
  assert.equal(parsed.organisation, 'SalesLogs Pty Limited');
  assert.equal(parsed.registrationDate, '2004-08-20');
  assert.equal(parsed.expiryDate, '2030-08-20');
  assert.equal(parsed.registrar, 'GoDaddy.com, LLC');
  assert.match(parsed.address, /100 Exhibition Street/);
  assert.match(parsed.address, /VIC/);
  assert.ok(parsed.domainAgeYears >= 21 && parsed.domainAgeYears <= 23, `expected ~22 years, got ${parsed.domainAgeYears}`);
  assert.equal(parsed.redacted, false);
  assert.deepStrictEqual(parsed.status, caseStudyRdap.status.slice(0, 20));
  // The ABN is carried in the payload's remarks for the later ABR/seed stages.
  assert.match(JSON.stringify(caseStudyRdap), /69 161 409 132/);
  assert.equal(normalise.abnDigits(caseStudyRdap.remarks[0].description[0]), ABN_DIGITS);
});

test('rdap.lookupRegistration() with populated RDAP never calls WHOIS', async () => {
  const calls = { rdap: [], whois: 0 };
  const deps = {
    ...noNetworkDeps(),
    fetchPublicJson: async (url) => {
      calls.rdap.push(url);
      return { json: caseStudyRdap, finalUrl: url };
    },
    query: async () => { calls.whois += 1; throw new Error('WHOIS must not be called'); },
  };
  const out = await rdap.lookupRegistration(DOMAIN, deps);
  assert.deepStrictEqual(calls.rdap, [`https://rdap.org/domain/${DOMAIN}`]);
  assert.equal(calls.whois, 0);
  assert.equal(out.organisation, 'SalesLogs Pty Limited');
  assert.equal(out.registrationDate, '2004-08-20');
  assert.equal(out.expiryDate, '2030-08-20');
  assert.equal(out.registrar, 'GoDaddy.com, LLC');
  assert.ok(out.domainAgeYears >= 21 && out.domainAgeYears <= 23);
  assert.equal(out.redacted, false);
});

test('rdap.lookupRegistration() falls back to WHOIS when RDAP is redacted', async () => {
  const calls = { whois: [] };
  const deps = {
    ...noNetworkDeps(),
    fetchPublicJson: async () => ({ json: redactedRdap, finalUrl: 'https://rdap.org/domain/saleslogs.com.au' }),
    query: async (server, domain) => {
      calls.whois.push({ server, domain });
      return whoisText;
    },
  };
  const out = await rdap.lookupRegistration(DOMAIN, deps);
  assert.deepStrictEqual(calls.whois, [{ server: 'whois.auda.org.au', domain: DOMAIN }]);
  assert.equal(out.organisation, 'SalesLogs Pty Limited');
  assert.equal(out.registrantName, 'SalesLogs Pty Limited');
  assert.equal(out.registrationDate, '2004-08-20');
  assert.equal(out.expiryDate, '2030-08-20');
  assert.equal(out.registrar, 'GoDaddy.com, LLC');
  assert.equal(out.redacted, false);
  assert.match(out.lookupSource, /RDAP \(rdap.org\) \+ WHOIS/);
});

test('rdap.lookupRegistration() fails soft when every source is unavailable', async () => {
  const deps = {
    ...noNetworkDeps(),
    fetchPublicJson: async () => { throw new Error('RDAP is down'); },
    query: async () => { throw new Error('WHOIS is down'); },
  };
  const out = await rdap.lookupRegistration(DOMAIN, deps);
  assert.equal(out.domain, DOMAIN);
  assert.equal(out.lookupSource, 'unavailable');
  assert.equal(out.redacted, true);
  assert.equal(out.domainAgeYears, null);
  assert.match(out.error, /RDAP is down; WHOIS fallback: WHOIS is down/);
});

// ── website.js ──────────────────────────────────────────────────────────────────────────

test('website.extractSocialLinks() finds all five networks', () => {
  const links = website.extractSocialLinks(HOME_HTML);
  const byNetwork = Object.fromEntries(links.map((l) => [l.network, l]));
  assert.deepStrictEqual(Object.keys(byNetwork).sort(), ['facebook', 'instagram', 'linkedin', 'twitter', 'youtube']);
  assert.equal(byNetwork.facebook.handle, 'saleslogs');
  assert.equal(byNetwork.instagram.handle, 'saleslogs');
  assert.equal(byNetwork.twitter.url, 'https://x.com/saleslogs');
  assert.equal(byNetwork.linkedin.handle, 'saleslogs');
  assert.equal(byNetwork.youtube.handle, 'saleslogs');
});

test('website.extractContact() finds email, phone and a Victorian address', () => {
  const contact = website.extractContact(PAGES[`https://${DOMAIN}/contact`].text);
  assert.deepStrictEqual(contact.emails, ['hello@saleslogs.com.au']);
  assert.ok(contact.phones.includes('+61 3 9000 1234'));
  assert.ok(contact.addresses.some((a) => /100 Exhibition Street/.test(a) && /VIC/.test(a)));
});

test('website.techFromHtml() labels analytics evidence from the page source', () => {
  const analytics = website.extractAnalytics(HOME_HTML);
  assert.deepStrictEqual(analytics, ['Google Analytics', 'Google Tag Manager', 'Meta Pixel']);
  const tech = website.techFromHtml(HOME_HTML, analytics);
  assert.deepStrictEqual(tech.analytics, analytics);
  assert.deepStrictEqual(tech.detected, analytics.map((name) => ({ category: 'Analytics', name, evidence: 'website source' })));
});

test('website.extractPeople() keeps explicit role lines', () => {
  const people = website.extractPeople('Jane Smith — CEO\nJohn Doe — Founder\nNo role on this line');
  assert.deepStrictEqual(people, [
    { name: 'Jane Smith', role: 'CEO' },
    { name: 'John Doe', role: 'Founder' },
  ]);
});

test('website.extractFacts() takes only explicitly stated staff, founding year and industry', () => {
  const facts = website.extractFacts(PAGES[`https://${DOMAIN}/about`].text);
  assert.equal(facts.employeeCount, 13);
  assert.equal(facts.foundedYear, 2004);
  assert.ok(facts.industryHints.includes('automotive SaaS'));
  assert.ok(facts.industryHints.includes('software / SaaS'));
});

test('website.scrapeWebsite() assembles four injected pages into a structured result', async () => {
  const deps = websiteDeps();
  const out = await website.scrapeWebsite(DOMAIN, deps);
  assert.equal(out.domain, DOMAIN);
  assert.deepStrictEqual(deps.seen, [
    `https://${DOMAIN}/`,
    `https://${DOMAIN}/about`,
    `https://${DOMAIN}/contact`,
    `https://${DOMAIN}/sitemap.xml`,
  ]);
  assert.equal(out.pages.length, 4);
  assert.ok(out.pages.some((p) => p.url === `https://${DOMAIN}/contact` && p.status === 200));
  assert.equal(out.description, 'Automotive SaaS for Australian workshops');
  assert.ok(out.keywords.includes('automotive') && out.keywords.includes('saas'));

  assert.ok(out.socialLinks.some((l) => l.network === 'facebook' && l.handle === 'saleslogs'));
  assert.ok(out.socialLinks.some((l) => l.network === 'instagram'));
  assert.ok(out.socialLinks.some((l) => l.network === 'twitter'));
  assert.ok(out.socialLinks.some((l) => l.network === 'linkedin'));
  assert.ok(out.socialLinks.some((l) => l.network === 'youtube'));
  assert.ok(out.phones.includes('+61 3 9000 1234'));
  assert.ok(out.emails.includes('hello@saleslogs.com.au'));
  assert.ok(out.addresses.some((a) => /100 Exhibition Street/.test(a) && /VIC/.test(a)));
  assert.ok(out.people.some((p) => p.name === 'Jane Smith' && p.role === 'CEO'));
  assert.deepStrictEqual(out.sitemapUrls, [
    `https://${DOMAIN}/`,
    `https://${DOMAIN}/about`,
    `https://${DOMAIN}/contact`,
  ]);
  assert.deepStrictEqual(out.analytics, ['Google Analytics', 'Google Tag Manager', 'Meta Pixel']);
  assert.equal(out.employeeCount, 13);
  assert.equal(out.foundedYear, 2004);
  assert.ok(out.industryHints.includes('automotive SaaS'));
  assert.equal(out.tech.detected.length, 3);
});

// ── dns.js (injected resolver) ──────────────────────────────────────────────────────────

test('dns.values() and dns.lookupDns() keep the DNS tool shape with injected records', async () => {
  assert.deepStrictEqual(dns.values([{ value: 'a' }, { value: '' }, {}]), ['a']);
  const out = await dns.lookupDns(DOMAIN, { dnsLib: dnsLib() });
  assert.equal(out.domain, DOMAIN);
  assert.equal(out.resolver, 'cloudflare');
  assert.deepStrictEqual(out.MX, ['aspmx.l.google.com']);
  assert.deepStrictEqual(out.NS, ['ns.cloudflare.com']);
  assert.ok(out.TXT.includes('v=spf1 include:hubspot.com ~all'));
  // DMARC lives in `records` / `raw.email`, not as a top-level property of lookupDns().
  assert.ok(out.records.some((r) => r.type === 'DMARC' && r.records[0].value === 'v=DMARC1; p=none'));
  assert.equal(out.raw.email.dmarc.records[0].value, 'v=DMARC1; p=none');
  assert.ok(out.records.some((r) => r.type === 'TXT' && !r.error));
});

// ── techStack.js ────────────────────────────────────────────────────────────────────────

test('techStack.detectTech() labels each inference with its evidence', () => {
  const seed = {
    dns: {
      MX: ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'],
      NS: ['ns.cloudflare.com', 'ns2.cloudflare.com'],
      TXT: ['v=spf1 include:hubspot.com ~all', 'google-site-verification=abc123'],
      CNAME: ['www.saleslogs.com.au.cdn.cloudflare.net'],
    },
    website: {
      analytics: ['Google Analytics', 'Google Tag Manager', 'Meta Pixel'],
      raw: { homepage: '<script src="https://www.google-analytics.com/analytics.js"></script><link href="https://cdn.cloudflare.com/style.css">' },
    },
  };
  const tech = techStack.detectTech(seed);
  const names = (list) => list.map((x) => x.name);

  assert.ok(names(tech.emailProvider).includes('Google Workspace'));
  assert.match(tech.emailProvider.find((x) => x.name === 'Google Workspace').evidence, /^MX record: aspmx\.l\.google\.com/);
  assert.ok(names(tech.hosting).includes('Cloudflare DNS'));
  assert.ok(names(tech.cdn).includes('Cloudflare'));
  assert.deepStrictEqual(names(tech.analytics), ['Google Analytics', 'Google Tag Manager', 'Meta Pixel']);
  assert.ok(names(tech.crmMarketing).includes('HubSpot'));
  assert.ok(names(tech.thirdPartyServices).includes('HubSpot'));
  assert.ok(names(tech.thirdPartyServices).includes('Google Search Console'));
  assert.ok(tech.crmMarketing.every((x) => /DNS TXT|website source/.test(x.evidence)));
  assert.ok(tech.thirdPartyServices.every((x) => /^DNS TXT/.test(x.evidence)));
});

// ── sources.js ──────────────────────────────────────────────────────────────────────────

test('sources.configured() reports presence only, never the credential values', () => {
  const saved = snapshotEnv();
  try {
    ENV_KEYS.forEach((key) => { process.env[key] = `super-secret-${key}`; });
    const config = sources.configured();
    assert.deepStrictEqual(config, { abr: true, places: true, googleSearch: true, asic: false });
    assert.ok(!JSON.stringify(config).includes('super-secret'), 'no key value leaks into the config');
    ENV_KEYS.forEach((key) => { delete process.env[key]; });
    assert.deepStrictEqual(sources.configured(), { abr: false, places: false, googleSearch: false, asic: false });
  } finally {
    restoreEnv(saved);
  }
});

test('sources.runModule() skips keyed modules without keys before any call is made', async () => {
  const saved = snapshotEnv();
  try {
    ENV_KEYS.forEach((key) => { delete process.env[key]; });
    const ctx = { deps: noNetworkDeps() };
    const seed = { domain: DOMAIN };
    const abr = await sources.runModule('abr', seed, ctx);
    const places = await sources.runModule('places', seed, ctx);
    const search = await sources.runModule('googleSearch', seed, ctx);
    assert.equal(abr.status, 'skipped');
    assert.match(abr.reason, /ABR_GUID/);
    assert.equal(places.status, 'skipped');
    assert.match(places.reason, /GOOGLE_PLACES_API_KEY/);
    assert.equal(search.status, 'skipped');
    assert.match(search.reason, /GOOGLE_SEARCH_API_KEY/);
    assert.equal(abr.data, null);
  } finally {
    restoreEnv(saved);
  }
});

test('sources.seedAll() runs the four seed modules with injected dependencies', async () => {
  const webDeps = websiteDeps();
  const deps = {
    ...noNetworkDeps(),
    fetchPublicJson: async (url) => ({ json: caseStudyRdap, finalUrl: url }),
    dnsLib: dnsLib(),
    fetchHtml: webDeps.fetchHtml,
    normaliseHttpUrl: webDeps.normaliseHttpUrl,
    htmlToText: webDeps.htmlToText,
    providers: {
      domscan: (path, args) => ({ path, domain: args.domain, overview: 'ok' }),
    },
  };
  const { seed, results } = await sources.seedAll(DOMAIN, { deps });
  assert.deepStrictEqual(Object.keys(results).sort(), ['dns', 'domainsTool', 'registration', 'website']);
  for (const [name, result] of Object.entries(results)) {
    assert.equal(result.status, 'success', `${name} succeeded`);
  }
  assert.equal(seed.domain, DOMAIN);
  assert.equal(seed.registration.organisation, 'SalesLogs Pty Limited');
  assert.equal(seed.registration.registrationDate, '2004-08-20');
  assert.equal(seed.dns.domain, DOMAIN);
  assert.ok(seed.dns.MX.includes('aspmx.l.google.com'));
  assert.equal(seed.website.domain, DOMAIN);
  assert.equal(seed.website.employeeCount, 13);
  assert.deepStrictEqual(seed.domainsTool, { path: '/overview', domain: DOMAIN, overview: 'ok' });
  assert.match(seed.checkedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

// ── reconcile.js ────────────────────────────────────────────────────────────────────────

test('reconcile.reconcile() keeps every value, labels agreement and preserves decisions', () => {
  const seed = {
    domain: DOMAIN,
    website: { pages: [{ url: `https://${DOMAIN}/contact` }] },
  };
  const results = {
    registration: {
      status: 'success',
      data: {
        organisation: 'SalesLogs Pty Limited',
        registrantName: 'SalesLogs Pty Limited',
        address: '100 Exhibition Street, Melbourne, VIC 3000',
        lookupUrl: 'https://rdap.org/domain/saleslogs.com.au',
      },
    },
    abr: { status: 'success', data: { entityName: 'SalesLogs Pty Limited', abn: ABN } },
    places: {
      status: 'success',
      data: { phone: '+61 3 9000 1234', address: '200 Lonsdale Street, Melbourne, VIC 3000' },
    },
  };
  const decision = 'Use the ABR entity name';
  const out = reconcile.reconcile(seed, results, { businessName: decision });

  assert.deepStrictEqual(out.conflicts, ['address']);
  assert.equal(out.fields.businessName.confidence.level, 'confirmed');
  assert.equal(out.fields.businessName.confidence.icon, '✅');
  assert.deepStrictEqual(out.fields.businessName.values.map((v) => [v.value, v.source]), [
    ['SalesLogs Pty Limited', 'RDAP / WHOIS'],
    ['SalesLogs Pty Limited', 'ABN Lookup (ABR)'],
  ]);
  assert.equal(out.fields.businessName.decision, decision, 'a user decision is never overwritten');

  assert.equal(out.fields.phone.confidence.level, 'single');
  assert.equal(out.fields.phone.confidence.icon, '⚠️');
  assert.deepStrictEqual(out.fields.phone.values.map((v) => [v.value, v.source]), [
    ['+61 3 9000 1234', 'Google Places'],
  ]);

  assert.equal(out.fields.address.confidence.level, 'conflicting');
  assert.equal(out.fields.address.confidence.icon, '❌');
  assert.deepStrictEqual(out.fields.address.values.map((v) => [v.value, v.source]), [
    ['100 Exhibition Street, Melbourne, VIC 3000', 'RDAP / WHOIS'],
    ['200 Lonsdale Street, Melbourne, VIC 3000', 'Google Places'],
  ]);
  assert.deepStrictEqual(out.fields.abn.values.map((v) => v.value), [ABN]);
});

// ── case-study integration: mocked seed + results only ─────────────────────────────────

test('case study: SalesLogs profile assembles entity, industry, Victoria, ~2004 and 13 staff', async () => {
  const scraped = await website.scrapeWebsite(DOMAIN, websiteDeps());
  const registration = rdap.parseRdap(caseStudyRdap, DOMAIN); // no network: pure parser
  const seed = { domain: DOMAIN, website: { pages: scraped.pages } };
  const results = {
    registration: { status: 'success', data: registration },
    abr: { status: 'success', data: { abn: ABN, entityName: 'SalesLogs Pty Limited', abnStatus: 'Active', state: 'VIC' } },
    website: { status: 'success', data: scraped },
    // Mocked Stage 2 result: detectTech() itself currently throws (see the test above).
    techStack: {
      status: 'success',
      data: {
        analytics: website.extractAnalytics(HOME_HTML).map((name) => ({ name, evidence: 'website source' })),
        emailProvider: [{ name: 'Google Workspace', evidence: 'MX record: aspmx.l.google.com' }],
        hosting: [{ name: 'Cloudflare DNS', evidence: 'NS record: ns.cloudflare.com' }],
      },
    },
  };
  const reconciliation = reconcile.reconcile(seed, results, {});
  const cards = buildCards(seed, results, reconciliation);

  assert.equal(cards.entity.businessName, 'SalesLogs Pty Limited');
  assert.equal(cards.entity.abn, ABN);
  assert.equal(cards.entity.registrantOrganisation, 'SalesLogs Pty Limited');
  assert.equal(cards.entity.registrationDate, '2004-08-20');
  assert.ok(cards.entity.domainAgeYears >= 21 && cards.entity.domainAgeYears <= 23,
    `expected ~22 years from a 2004 registration, got ${cards.entity.domainAgeYears}`);

  assert.ok(cards.products.industryHints.includes('automotive SaaS'));
  assert.ok(cards.products.keywords.includes('automotive'));
  assert.ok(cards.products.keywords.includes('saas'));
  assert.ok(cards.locations.some((l) => /VIC|Victoria/i.test(l.value)), 'a Victorian address is retained');

  assert.equal(cards.financial.employeeCount, 13);
  assert.ok(cards.financial.yearsInBusiness >= 21 && cards.financial.yearsInBusiness <= 23);
  assert.ok(cards.digital.analytics.includes('Google Analytics'));
  assert.equal(cards.people[0].name, 'Jane Smith');
});

// Postgres refuses a parameter whose uses imply two types ("inconsistent types deduced for parameter $3"):
// finishProfile once used $3 as status = $3 (VARCHAR) and $3 = 'done' (text), so every run failed at the last step.
// The store has no database in these tests, so read each SQL string and require every reused $N to carry one explicit cast at each use.
test('store SQL: a reused parameter has one explicit cast at every use', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'store.js'), 'utf8');
  // the text inside each pair of backticks (store.js has no backtick in a comment), keeping those that hold a $N parameter
  const sqls = src.split('`').filter((part, i) => i % 2 === 1 && /\$\d/.test(part));
  assert.ok(sqls.length > 5);
  for (const sql of sqls) {
    const casts = {};
    for (const [, n, cast] of sql.matchAll(/\$(\d+)(::[a-z\[\]]+)?/g)) (casts[n] ||= []).push(cast || '');
    for (const [n, uses] of Object.entries(casts)) {
      if (uses.length < 2) continue;
      // reused: every use needs the same explicit cast, or Postgres deduces a type per use and may disagree
      assert.ok(uses[0] && uses.every((u) => u === uses[0]), `$${n} is reused without one explicit cast (${uses.join(' / ') || 'none'}) in: ${sql.slice(0, 80)}`);
    }
  }
});

// ── fixes from the live saleslogs.com profile (2026-11-23) ──────────────────────────────
// The real footer: "Level 10, 637 Flinders Street<br>Docklands VIC 3008<br>Australia" and "©Copyright 2005-2026 SalesLogs Pty Ltd".

test('website.looksLikePhone() keeps phone numbers and refuses dates, year ranges and ids', () => {
  for (const ok of ['+61 2 9855 7852', '(03) 9000 1234', '0412 345 678', '1300 123 456', '+1 415 555 0100']) assert.ok(website.looksLikePhone(ok), ok);
  for (const bad of ['2026-11-10', '2005-2026', '4 2023-11-03', '313209466-1', '2026-05-21', '12345678']) assert.ok(!website.looksLikePhone(bad), bad);
});

test('website.extractContact() reads an address split over lines and an ABN printed on the page', () => {
  const c = website.extractContact('Level 10, 637 Flinders Street\nDocklands VIC 3008\nAustralia\nPhone: +61 2 9855 7852\nABN: 69 161 409 132\n© 2005-2026');
  assert.deepStrictEqual(c.addresses, ['Level 10, 637 Flinders Street, Docklands VIC 3008']);
  assert.deepStrictEqual(c.phones, ['+61 2 9855 7852']);
  assert.deepStrictEqual(c.abns, ['69 161 409 132']);
});

test('website.extractNames() takes the legal name from the © line and the site name from page titles', () => {
  const names = website.extractNames([
    { title: 'Evolve on from spreadsheets with SalesLogs', text: 'Footer\n©Copyright 2005-2026 SalesLogs Pty Ltd\nPrivacy', html: '' },
    { title: 'About Us | SalesLogs', text: '' },
  ]);
  assert.equal(names.legalName, 'SalesLogs Pty Ltd');
  assert.equal(names.siteName, 'SalesLogs');
  assert.equal(website.extractNames([{ title: 'Home', text: '© 2024 Just A Name. All rights reserved', html: '' }]).legalName, null, 'no company suffix, no legal name');
});

test('website.scrapeWebsite() keeps sitemap.xml out of the page text (its dates are not phones, its URLs not keywords)', async () => {
  const sitemap = '<urlset><url><loc>https://x.test/hubfs/thumbnail-gxkmybaq.png</loc><lastmod>2026-11-10</lastmod></url></urlset>';
  const out = await website.scrapeWebsite('x.test', {
    fetchHtml: async (url) => ({ statusCode: 200, body: url.endsWith('/sitemap.xml') ? sitemap : '<title>Page | X Test</title><p>Phone 03 9000 1234</p>' }),
    normaliseHttpUrl: (u) => u,
    htmlToText: (html) => html.replace(/<[^>]+>/g, '\n'),
  });
  assert.deepStrictEqual(out.phones, ['03 9000 1234']);
  assert.ok(!out.keywords.some((k) => /hubfs|thumbnail|gxkmybaq/.test(k)), out.keywords.join(','));
  assert.deepStrictEqual(out.sitemapUrls, ['https://x.test/hubfs/thumbnail-gxkmybaq.png']);
  assert.equal(out.siteName, 'X Test');
});

test('reconcile: the site name and the legal name are one business name from one source, not a conflict', () => {
  const r = reconcile.reconcile({ domain: 'saleslogs.com' }, { website: { data: { legalName: 'SalesLogs Pty Ltd', siteName: 'SalesLogs' } } });
  assert.deepStrictEqual(r.fields.businessName.values.map((v) => v.value), ['SalesLogs Pty Ltd', 'SalesLogs']);
  assert.equal(r.fields.businessName.confidence.level, 'single');
  assert.ok(!r.conflicts.includes('businessName'));
  const withAbr = reconcile.reconcile({}, { abr: { data: { entityName: 'SALESLOGS PTY LIMITED' } }, website: { data: { siteName: 'SalesLogs' } } });
  assert.equal(withAbr.fields.businessName.confidence.level, 'confirmed', 'ABR and the website agree once suffixes are ignored');
});

test('cards: a skipped Places module shows no Google rating, and years in business says what it is based on', () => {
  const cards = buildCards({ domain: 'x.test' }, { places: { status: 'skipped' }, registration: { data: { domainAgeYears: 13.6 } } }, {});
  assert.equal(cards.reputation.googlePlaces, null);
  assert.equal(cards.financial.yearsInBusiness, 13.6);
  assert.match(cards.financial.yearsInBusinessBasis, /domain age only/);
});

// ── summary.js: the written summary ─────────────────────────────────────────────────────
const summaryLib = require('./summary');

const SUMMARY_PROFILE = {
  id: 7, domain: 'saleslogs.com', status: 'done',
  seed: { website: { raw: { homepage: '<p>Supercharged Data-Grids for your dealership.</p><p>©Copyright 2005-2026 SalesLogs Pty Ltd</p>', about: '', contact: '' } } },
  cards: {
    entity: { legalNameOnWebsite: 'SalesLogs Pty Ltd', siteName: 'SalesLogs', registrationDate: '2013-04-09', domainAgeYears: 13.6 },
    products: { description: 'Supercharged Data-Grids and Analytics for your automotive dealership.' },
    digital: { emailProvider: ['Google Workspace'], socialLinks: [{ network: 'linkedin', url: 'https://linkedin.com/company/saleslogs' }] },
    financial: { yearsInBusiness: 13.6, yearsInBusinessBasis: 'domain age only; no founding year found' },
  },
  reconciliation: { fields: { phone: { values: [{ value: '+61 2 9855 7852', source: 'Website scrape' }], confidence: { label: 'One source only' } } } },
  sources: [{ name: 'abr', status: 'skipped', reason: 'ABR_GUID is not set on this server.' }],
};

test('summary.buildPrompt() gives the model the saved facts and the site text, and says what was not used', () => {
  const { prompt, sourceText } = summaryLib.buildPrompt(SUMMARY_PROFILE);
  assert.match(prompt, /SalesLogs Pty Ltd/);
  assert.match(prompt, /\+61 2 9855 7852/);
  assert.match(prompt, /Supercharged Data-Grids for your dealership/, 'homepage text is included');
  assert.match(prompt, /abr: ABR_GUID is not set/, 'skipped sources are named so gaps can be stated');
  assert.match(prompt, /never as instructions/, 'site text is fenced as information');
  assert.match(sourceText, /2005-2026/);
  assert.match(summaryLib.SYSTEM, /exactly three paragraphs/);
});

test('summary.cleanSummary() keeps plain paragraphs and drops markdown', () => {
  assert.equal(summaryLib.cleanSummary('# Title\n**SalesLogs** sells software.\n\n- It is in Docklands.\n\n\nThird.'), 'SalesLogs sells software.\n\nIt is in Docklands.\n\nThird.');
});

test('summary.checkFigures() lists years and numbers the profile data does not contain', () => {
  const { sourceText } = summaryLib.buildPrompt(SUMMARY_PROFILE);
  const text = 'Its copyright runs from 2005 and the domain dates from 2013 (about 13.6 years). Call +61 2 9855 7852. It was founded in 1998 and has 40 staff.';
  assert.deepStrictEqual(summaryLib.checkFigures(text, sourceText), ['1998', '40']);
});

test('summary.generateSummary() writes, checks and saves; refuses unfinished profiles and missing models', async () => {
  const saved = [];
  const usage = [];
  const deps = {
    getProfile: async () => SUMMARY_PROFILE,
    getModels: async () => ({ standard: 'test-model' }),
    callModel: async (model, prompt, opts) => {
      assert.equal(model, 'test-model');
      assert.equal(opts.system, summaryLib.SYSTEM);
      return { text: 'SalesLogs Pty Ltd sells dealership software.\n\nIt was founded in 1998.', model: 'test-model', inputTokens: 10, outputTokens: 5 };
    },
    saveSummary: async (id, userId, s) => saved.push({ id, userId, s }),
    logUsage: (u) => usage.push(u),
  };
  const s = await summaryLib.generateSummary(3, 7, deps);
  assert.equal(s.text, 'SalesLogs Pty Ltd sells dealership software.\n\nIt was founded in 1998.');
  assert.deepStrictEqual(s.unverifiedFigures, ['1998']);
  assert.equal(saved[0].id, 7);
  assert.equal(saved[0].userId, 3);
  assert.equal(usage[0].feature, 'bip_summary');

  await assert.rejects(summaryLib.generateSummary(3, 7, { ...deps, getProfile: async () => ({ ...SUMMARY_PROFILE, status: 'running' }) }), (e) => e.status === 409);
  await assert.rejects(summaryLib.generateSummary(3, 7, { ...deps, getModels: async () => ({}) }), (e) => e.status === 503);
  await assert.rejects(summaryLib.generateSummary(3, 7, { ...deps, getProfile: async () => null }), (e) => e.status === 404);
});

// ── more of the company's own site: legal, people and history pages ─────────────────────
test('website.pickExtraPages() picks same-site legal, people and history pages by the last part of the path', () => {
  const home = '<a href="/terms">Terms</a><a href="https://www.x.test/privacy">Privacy</a><a href="/teams">Product</a>'
    + '<a href="/benefits-sales-team">Benefits</a><a href="https://news.x.test/press">Other host</a><a href="/files/terms.pdf">PDF</a><a href="/history/">History</a>';
  const picked = website.pickExtraPages('x.test', home, ['https://x.test/our-team', 'https://x.test/about'], ['https://x.test/about']);
  assert.deepStrictEqual(picked, ['https://x.test/terms', 'https://www.x.test/privacy', 'https://x.test/our-team', 'https://x.test/history']);
});

test('website.scrapeWebsite() reads the legal pages for the entity name and ABN, but not their phone numbers', async () => {
  const pages = {
    '/': '<title>Home | Acme</title><a href="/terms">Terms</a><a href="/privacy">Privacy</a><p>Call 02 9000 1111</p>',
    '/terms': '<p>A. Acme Widgets Pty Limited ABN 69 161 409 132 ("Acme") provides the service.</p>',
    '/privacy': '<p>Complain to the OAIC on 1300 363 992.</p>',
  };
  const seen = [];
  const out = await website.scrapeWebsite('acme.test', {
    fetchHtml: async (url) => { seen.push(url); const p = new URL(url).pathname; return pages[p] ? { statusCode: 200, body: pages[p] } : { statusCode: 404, body: '' }; },
    normaliseHttpUrl: (u) => u,
    htmlToText: (html) => html.replace(/<[^>]+>/g, '\n'),
  });
  assert.ok(seen.includes('https://acme.test/terms') && seen.includes('https://acme.test/privacy'));
  assert.equal(out.legalName, 'Acme Widgets Pty Limited', 'the name before the ABN, without the "A." list label');
  assert.deepStrictEqual(out.abns, ['69 161 409 132']);
  assert.deepStrictEqual(out.phones, ['02 9000 1111'], 'the regulator number on the privacy page is not the business phone');
  assert.deepStrictEqual(out.extraPages.map((p) => p.url), ['https://acme.test/terms', 'https://acme.test/privacy']);
});

test('website.extractAddresses() ignores sentences that only look like addresses', () => {
  assert.deepStrictEqual(website.extractAddresses('This Privacy Policy replaces the policy previously published (last updated July 2020)\nIt applied until 15 November 2026'), []);
  assert.deepStrictEqual(website.extractAddresses('Shop 4, 12 King Street\nNewcastle NSW 2300\nAustralia'), ['Shop 4, 12 King Street, Newcastle NSW 2300']);
});

// ── abrPublic.js: the public ABN Lookup history page (no key) ───────────────────────────
const abrPublic = require('./abrPublic');
const ABN_HISTORY_HTML = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'abnHistory-69161409132.html'), 'utf8');

test('abrPublic.parseAbnHistory() reads names, status, GST, location history and ACN from the real page', () => {
  const r = abrPublic.parseAbnHistory(ABN_HISTORY_HTML, '69161409132');
  assert.equal(r.entityName, 'SALESLOGS PTY LTD');
  assert.deepStrictEqual(r.nameHistory, [
    { value: 'SALESLOGS PTY LTD', from: '2012-12-11', to: null },
    { value: 'SALESLOG PTY LTD', from: '2012-12-10', to: '2012-12-11' },
  ]);
  assert.equal(r.entityType, 'Australian Private Company');
  assert.equal(r.abnStatus, 'Active from 10 Dec 2012');
  assert.equal(r.registrationDate, '2012-12-10');
  assert.equal(r.gstStatus, 'Registered from 10 Dec 2012');
  assert.equal(`${r.state} ${r.postcode}`, 'NSW 2284');
  assert.deepStrictEqual(r.locationHistory.map((l) => l.value), ['NSW 2284', 'NSW 2769', 'NSW 2000', 'NSW 2000', 'NSW 2000', 'NSW 2326']);
  assert.equal(r.acn, '161 409 132');
  assert.equal(r.lookupUrl, 'https://abr.business.gov.au/ABN/View?abn=69161409132');
  assert.equal(abrPublic.parseAbnHistory('<html>No record</html>', '1'), null);
});

test('sources abr: without ABR_GUID, an ABN from the website is looked up on the public page; without an ABN it is skipped', async () => {
  const saved = process.env.ABR_GUID;
  delete process.env.ABR_GUID;
  try {
    const seen = [];
    const deps = { fetchHtml: async (url) => { seen.push(url); return { statusCode: 200, body: ABN_HISTORY_HTML }; } };
    const found = await sources.runModule('abr', { domain: 'saleslogs.com', website: { abns: ['69 161 409 132'] } }, { deps });
    assert.equal(found.status, 'success');
    assert.equal(found.data.entityName, 'SALESLOGS PTY LTD');
    assert.deepStrictEqual(seen, ['https://abr.business.gov.au/AbnHistory/View?id=69161409132']);
    const none = await sources.runModule('abr', { domain: 'x.test', website: { abns: [] } }, { deps });
    assert.equal(none.status, 'skipped');
    assert.match(none.reason, /No ABN was found on the website/);
  } finally { if (saved !== undefined) process.env.ABR_GUID = saved; }
});

test('ABN Lookup data: names and ABN confirmed with the website, NSW location disagrees with a Docklands address, years from the ABN', () => {
  const abr = abrPublic.parseAbnHistory(ABN_HISTORY_HTML, '69161409132');
  const results = {
    abr: { data: abr },
    website: { data: { legalName: 'SalesLogs Pty Ltd', siteName: 'SalesLogs', abns: ['69 161 409 132'], addresses: ['Level 10, 637 Flinders Street, Docklands VIC 3008'] } },
  };
  const r = reconcile.reconcile({ domain: 'saleslogs.com' }, results);
  assert.equal(r.fields.businessName.confidence.level, 'confirmed');
  assert.equal(r.fields.abn.confidence.level, 'confirmed');
  assert.equal(r.fields.address.confidence.level, 'conflicting');
  assert.ok(r.fields.address.values.some((v) => v.value === 'NSW 2284' && /main business location/.test(v.source)));
  const cards = buildCards({ domain: 'saleslogs.com' }, { ...results, registration: { data: { domainAgeYears: 13.6 } } }, r);
  assert.equal(cards.entity.acn, '161 409 132');
  assert.deepStrictEqual(cards.entity.formerNames, ['SALESLOG PTY LTD (2012-12-10 to 2012-12-11)']);
  assert.match(cards.financial.yearsInBusinessBasis, /ABN registered 2012-12-10/);
  assert.ok(cards.financial.yearsInBusiness > 13);
});
