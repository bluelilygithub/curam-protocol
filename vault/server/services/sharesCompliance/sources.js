'use strict';

// Shares Compliance Advisory: the pages this tool may read. The addresses are a fixed allow-list in code —
// no URL from a person, no URL from a model answer and no URL from a scraped page is ever fetched. See
// docs/shares-compliance.md.

const ALLOWED_HOSTS = new Set(['www.ato.gov.au', 'ato.gov.au']);
const MAX_SOURCES = 10;

const SOURCES = Object.freeze([
  {
    id: 'advice-guidance',
    label: 'ATO advice and guidance',
    url: 'https://www.ato.gov.au/about-ato/ato-advice-and-guidance',
    focus: 'New and changed public advice and guidance that may affect how share records are kept.',
  },
  {
    id: 'advice-under-development',
    label: 'Advice under development',
    url: 'https://www.ato.gov.au/about-ato/ato-advice-and-guidance/advice-under-development-program',
    focus: 'Topics where the ATO is still developing guidance.',
  },
  {
    id: 'recent-advice-updates',
    label: 'Recent advice updates',
    url: 'https://www.ato.gov.au/about-ato/ato-advice-and-guidance/advice-under-development-program/recent-updates-and-how-to-contact-us-about-public-advice-and-guidance',
    focus: 'Recent changes to public advice and guidance.',
  },
  {
    id: 'small-business-newsroom',
    label: 'ATO small business newsroom',
    url: 'https://www.ato.gov.au/businesses-and-organisations/small-business-newsroom',
    focus: 'Small business announcements, including changes that can reach an investor’s own records.',
  },
  {
    id: 'small-business-whats-new',
    label: 'What’s new for small business',
    url: 'https://www.ato.gov.au/tax-and-super-professionals/for-tax-professionals/prepare-and-lodge/tax-time/tax-time-toolkits/tax-time-toolkit-small-business/whats-new-for-small-business',
    focus: 'Summarised changes to obligations and dates for small business.',
  },
  {
    id: 'tax-law-news',
    label: 'Latest tax law and policy news',
    url: 'https://ato.gov.au/about-ato/new-legislation/latest-news-on-tax-law-and-policy',
    focus: 'Announced law and policy changes that may need an accountant’s review.',
  },
  {
    id: 'whats-new-law-view',
    label: 'ATO law view — what’s new',
    url: 'https://www.ato.gov.au/law/view/whatsnew.htm?fid=whatsnew',
    focus: 'Changes recorded in the ATO legislation and law view.',
  },
]);

function isAllowedAtoUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim());
    return u.protocol === 'https:'
      && ALLOWED_HOSTS.has(u.hostname.toLowerCase())
      && !u.username && !u.password
      && (!u.port || u.port === '443');
  } catch {
    return false;
  }
}

function sourcesForRun() {
  return SOURCES.slice(0, MAX_SOURCES).map((s) => ({ ...s }));
}

module.exports = { SOURCES, ALLOWED_HOSTS, MAX_SOURCES, isAllowedAtoUrl, sourcesForRun };
