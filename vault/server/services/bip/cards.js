'use strict';

// BIP stage 4: turn the seed, the source results and the reconciliation into the seven profile cards the page shows.
// Nothing here guesses a value: absent facts stay absent and are shown as "Not found" by the client.

const { cleanText } = require('./normalise');

const val = (v) => cleanText(v, 300);

function first(values) {
  return (Array.isArray(values) ? values.find((v) => v) : null) || null;
}

function buildCards(seed = {}, results = {}, reconciliation = {}) {
  const d = Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v?.data || {}]));
  const w = d.website || {};
  const r = d.registration || {};
  const a = d.abr || {};
  const p = d.places || {};
  const t = d.techStack || {};
  const g = d.googleSearch || {};
  const f = reconciliation.fields || {};

  const entity = {
    businessName: val(first(f.businessName?.values?.map((v) => v.value)) || a.entityName || r.organisation || r.registrantName),
    abn: val(first(f.abn?.values?.map((v) => v.value)) || a.abn),
    entityType: val(a.entityType),
    gstStatus: val(a.gstStatus),
    tradingNames: Array.isArray(a.tradingNames) ? a.tradingNames : [],
    domain: seed.domain || r.domain || null,
    domainAgeYears: r.domainAgeYears ?? null,
    registrationDate: r.registrationDate || null,
    expiryDate: r.expiryDate || null,
    companyStatus: val(a.abnStatus || (r.status || []).join(', ')),
    registrar: val(r.registrar),
    registrantOrganisation: val(r.organisation || r.registrantName),
  };

  const people = [
    ...(Array.isArray(w.people) ? w.people.map((x) => ({ ...x, source: 'Website scrape' })) : []),
    ...(Array.isArray(d.asic?.directors) ? d.asic.directors.map((x) => ({ ...x, source: 'ASIC Connect' })) : []),
  ];

  const locations = (f.address?.values || []).map((v) => ({ ...v, confidence: f.address.confidence }));

  const products = {
    description: val(w.description),
    keywords: Array.isArray(w.keywords) ? w.keywords.slice(0, 20) : [],
    industryHints: Array.isArray(w.industryHints) ? w.industryHints : [],
    sitemapUrls: Array.isArray(w.sitemapUrls) ? w.sitemapUrls.slice(0, 20) : [],
  };

  const digital = {
    emailProvider: (t.emailProvider || []).map((x) => x.name),
    hosting: (t.hosting || []).map((x) => x.name),
    cdn: (t.cdn || []).map((x) => x.name),
    analytics: (t.analytics || []).map((x) => x.name),
    crmMarketing: (t.crmMarketing || []).map((x) => x.name),
    thirdPartyServices: t.thirdPartyServices || [],
    socialLinks: d.socialLinks?.profiles || w.socialLinks || [],
    dnsRecords: {
      MX: d.dns?.MX || [], NS: d.dns?.NS || [], TXT: d.dns?.TXT || [], CNAME: d.dns?.CNAME || [],
    },
  };

  const reputation = {
    googlePlaces: p.rating === null && p.reviewCount === null ? null : { rating: p.rating, reviewCount: p.reviewCount, url: p.mapsUrl || null, source: 'Google Places' },
    productReview: d.productReview?.rating == null ? null : { rating: d.productReview.rating, reviewCount: d.productReview.reviewCount ?? null, url: d.productReview.listingUrl || null, source: 'ProductReview.com.au' },
    trustpilot: d.trustpilot?.rating == null ? null : { rating: d.trustpilot.rating, reviewCount: d.trustpilot.reviewCount ?? null, url: d.trustpilot.listingUrl || null, source: 'Trustpilot' },
    mentions: Array.isArray(g.results) ? g.results.slice(0, 10) : [],
  };

  const financial = {
    label: 'estimates from public sources',
    revenueEstimate: null,
    employeeCount: w.employeeCount ?? null,
    fundingStatus: null,
    yearsInBusiness: w.foundedYear ? Math.max(0, new Date().getFullYear() - Number(w.foundedYear)) : (entity.domainAgeYears ?? null),
    note: 'Revenue and funding are not published by the sources BIP reads. Only the figures below were found; blanks are not estimates.',
  };

  return {
    entity,
    people,
    locations,
    products,
    digital,
    reputation,
    financial,
  };
}

module.exports = { buildCards };
