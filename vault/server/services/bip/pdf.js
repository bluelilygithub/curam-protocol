'use strict';

// BIP's "Download PDF" export. Uses the same @react-pdf/renderer pattern as the rest of Vault, with built-in Helvetica fonts so no
// extra files or network calls are needed. The PDF is a faithful, plain rendering of the saved profile — no fresh lookups.

const React = require('react');
const { winAnsiSafe } = require('../webExtractorPdf');

const safe = (v) => winAnsiSafe(String(v ?? '')).text;

function buildDocument(deps, profile) {
  const { Document, Page, Text, View, StyleSheet } = deps;
  const s = StyleSheet.create({
    page: { fontSize: 9.5, fontFamily: 'Helvetica', color: '#1A1A1A', paddingHorizontal: 42, paddingTop: 40, paddingBottom: 40, lineHeight: 1.45 },
    title: { fontSize: 19, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
    sub: { fontSize: 9.5, color: '#6B7280', marginBottom: 12 },
    h2: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 5, borderBottomWidth: 1, borderBottomColor: '#E5E7EB', paddingBottom: 3 },
    row: { flexDirection: 'row', marginBottom: 3 },
    key: { width: 140, color: '#6B7280' },
    value: { flex: 1 },
    line: { marginBottom: 4 },
    muted: { color: '#6B7280' },
    badge: { fontSize: 8, color: '#6B7280', marginBottom: 6 },
  });
  const cards = profile.cards || {};
  const asText = (value) => {
    if (Array.isArray(value)) return value.map(asText).join(', ');
    if (value && typeof value === 'object') {
      if ('rating' in value) return `${value.rating ?? '—'}/5 from ${value.reviewCount ?? '?'} reviews (${value.source || 'public listing'})`;
      return Object.entries(value).map(([k, v]) => `${k}: ${asText(v)}`).join('; ');
    }
    return String(value ?? '');
  };
  const rows = (obj, keys) => keys.map(([label, key]) => {
    const value = obj?.[key];
    if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return null;
    return React.createElement(View, { key: String(key), style: s.row },
      React.createElement(Text, { style: s.key }, safe(label)),
      React.createElement(Text, { style: s.value }, safe(asText(value))));
  }).filter(Boolean);
  const list = (items, render) => (Array.isArray(items) ? items : []).slice(0, 20).map((item, i) => React.createElement(Text, { key: String(i), style: s.line }, safe(render(item))));
  const section = (title, children) => React.createElement(View, null,
    React.createElement(Text, { style: s.h2 }, safe(title)), ...children);

  const entity = cards.entity || {};
  const financial = cards.financial || {};
  const web = cards.digital || {};
  const rep = cards.reputation || {};
  // words, not the ✅ ⚠️ ❌ icons: the built-in PDF fonts cannot draw them and printed "??" / "?"
  const conf = (f) => (f?.confidence?.label ? `[${f.confidence.label}]` : '');

  const children = [
    React.createElement(Text, { style: s.title }, safe(entity.businessName || profile.domain || 'Business profile')),
    React.createElement(Text, { style: s.sub }, safe(`${profile.domain || ''}  ·  profiled ${profile.scannedAt ? new Date(profile.scannedAt).toLocaleDateString('en-AU') : '—'}  ·  Vault Business Profiler`)),
    React.createElement(Text, { style: s.badge }, safe('Public-source profile. Each value is marked [Confirmed by 2+ sources], [One source only] or [Sources disagree]; BIP never resolves a disagreement.')),
    ...(profile.summary?.text ? [section('Summary', [
      ...profile.summary.text.split(/\n\s*\n/).map((para, i) => React.createElement(Text, { key: `sum-${i}`, style: { marginBottom: 6 } }, safe(para))),
      ...(profile.summary.unverifiedFigures?.length ? [React.createElement(Text, { key: 'sum-check', style: s.muted }, safe(`Not found in the profile data, so check: ${profile.summary.unverifiedFigures.join(', ')}.`))] : []),
      React.createElement(Text, { key: 'sum-by', style: s.muted }, safe(`Written by AI (${profile.summary.model || 'model'}) from this profile's public-source data only.`)),
    ])] : []),
    section('Entity overview', rows(entity, [
      ['Business name', 'businessName'], ['Legal name on website', 'legalNameOnWebsite'], ['ABN', 'abn'], ['Entity type', 'entityType'], ['GST status', 'gstStatus'],
      ['Trading names', 'tradingNames'], ['Domain', 'domain'], ['Domain age (years)', 'domainAgeYears'],
      ['Registered', 'registrationDate'], ['Expires', 'expiryDate'], ['Status', 'companyStatus'], ['Registrar', 'registrar'],
    ])),
    section('People', list(cards.people, (x) => `${x.name || 'Unknown'} — ${x.role || 'role not stated'} (${x.source || 'source not stated'})`)),
    section('Locations', list(cards.locations, (x) => `${x.value} — ${x.source || 'source not stated'} ${conf(x)}`)),
    section('Products & services', [
      ...rows(cards.products || {}, [['Description', 'description'], ['Industry hints', 'industryHints'], ['Keywords', 'keywords']]),
      ...(cards.products?.sitemapUrls?.length ? [React.createElement(Text, { key: 'sitemap-h', style: { ...s.muted, marginTop: 6, marginBottom: 3 } }, safe('Pages listed in the sitemap'))] : []),
      ...list(cards.products?.sitemapUrls, (u) => u),
    ]),
    section('Digital footprint', [
      ...rows(web, [['Email provider', 'emailProvider'], ['Hosting', 'hosting'], ['CDN', 'cdn'], ['Analytics', 'analytics'], ['CRM / marketing', 'crmMarketing']]),
      ...list(web.socialLinks, (x) => `${x.network}: ${x.url}`),
      ...list(web.thirdPartyServices, (x) => `${x.name} (${x.evidence})`),
    ]),
    section('Online presence & reputation', [
      ...rows(rep, [['Google Places', 'googlePlaces'], ['ProductReview', 'productReview'], ['Trustpilot', 'trustpilot']]).map((el) => el),
      ...list(rep.mentions, (x) => `${x.title || '(no title)'} — ${x.url || ''}`),
    ]),
    section('Financial indicators — estimates from public sources', rows(financial, [
      ['Employee count', 'employeeCount'], ['Years in business', 'yearsInBusiness'], ['Based on', 'yearsInBusinessBasis'], ['Revenue estimate', 'revenueEstimate'], ['Funding status', 'fundingStatus'],
    ]).concat(React.createElement(Text, { key: 'note', style: s.muted }, safe(financial.note || '')))),
    section('Sources & confidence', list((profile.sources || []).map((x) => ({ ...x, line: `${x.name}: ${x.status}${x.reason ? ` — ${x.reason}` : ''}${x.error ? ` — ${x.error}` : ''}` })), (x) => x.line)),
    section('Reconciliation', [
      ...Object.entries((profile.reconciliation?.fields || {})).flatMap(([key, field]) => [
        React.createElement(Text, { key: `${key}-h`, style: s.line }, safe(`${key}: ${conf(field)}`)),
        ...list(field.values || [], (v) => `  ${v.value} — ${v.source}${v.decision ? ` [decision: ${v.decision}]` : ''}`),
      ]),
    ]),
  ];

  return React.createElement(Document, null, React.createElement(Page, { size: 'A4', style: s.page }, ...children));
}

async function buildBipPdfBuffer(profile, deps = null) {
  const renderer = deps || await import('@react-pdf/renderer');
  return renderer.renderToBuffer(buildDocument(renderer, profile));
}

module.exports = { buildBipPdfBuffer, buildDocument };
