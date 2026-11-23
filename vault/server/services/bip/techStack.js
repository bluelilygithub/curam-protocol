'use strict';

// BIP Stage 2: infer the public technology stack from DNS records and the scraped page source. An inference is always labelled
// with the evidence that produced it — it is never presented as a fact supplied by the company.

const RULES = {
  email: [
    { name: 'Google Workspace', re: /(?:aspmx|googlemail|google)\.com/i },
    { name: 'Microsoft 365 / Exchange', re: /(?:outlook|hotmail|microsoft|exchange|protection\.outlook)\.(?:com|net)/i },
    { name: 'Proofpoint', re: /proofpoint/i },
    { name: 'Mimecast', re: /mimecast/i },
    { name: 'Zoho Mail', re: /zoho\.com/i },
    { name: 'Cloudflare Email Routing', re: /email\.cloudflare\.net/i },
  ],
  hosting: [
    { name: 'Cloudflare DNS', re: /cloudflare\.com/i },
    { name: 'AWS Route 53', re: /awsdns|amazonaws/i },
    { name: 'Google Cloud DNS', re: /googledomains|google\.com/i },
    { name: 'Azure DNS', re: /azure-dns|microsoftonline/i },
    { name: 'NS1', re: /nsone\.net/i },
    { name: 'DigitalOcean', re: /digitalocean/i },
  ],
  cdn: [
    { name: 'Cloudflare', re: /cloudflare|cdn-cgi/i },
    { name: 'Amazon CloudFront', re: /cloudfront\.net/i },
    { name: 'Fastly', re: /fastly\.net/i },
    { name: 'Akamai', re: /akamai|edgesuite|edgekey/i },
  ],
  crm: [
    { name: 'HubSpot', re: /hubspot/i },
    { name: 'Salesforce', re: /salesforce/i },
    { name: 'Mailchimp', re: /mailchimp/i },
    { name: 'SendGrid', re: /sendgrid/i },
    { name: 'Zoho', re: /zoho/i },
    { name: 'Atlassian', re: /atlassian/i },
  ],
};

function matchList(list, rules, evidence) {
  const seen = new Set();
  const found = [];
  for (const value of list || []) {
    for (const rule of rules) {
      if (rule.re.test(String(value)) && !seen.has(rule.name)) {
        seen.add(rule.name);
        found.push({ name: rule.name, evidence: `${evidence}: ${String(value).slice(0, 160)}` });
      }
    }
  }
  return found;
}

function detectTech(seed = {}) {
  const dns = seed.dns || {};
  const website = seed.website || {};
  const txt = dns.TXT || [];
  const text = txt.join(' ');
  const cname = dns.CNAME || [];
  const html = Object.values(website.raw || {}).join('\n');
  const mx = dns.MX || [];
  const ns = dns.NS || [];

  const analytics = (website.analytics || []).map((name) => ({ name, evidence: 'website source' }));
  const thirdParty = matchList(text.split(/\s+/).filter((t) => /^(?:include:|v=|google-site-verification=|facebook-domain-verification=|stripe-domain-validation=|atlassian-domain-verification=)/i.test(t)), RULES.crm, 'DNS TXT');
  const verification = [];
  for (const [name, re] of [
    ['Google Search Console', /google-site-verification=/i],
    ['Facebook', /facebook-domain-verification=/i],
    ['Stripe', /stripe-domain-validation=/i],
    ['Atlassian', /atlassian-domain-verification=/i],
  ]) if (re.test(text)) verification.push({ name, evidence: 'DNS TXT' });

  return {
    emailProvider: matchList(mx, RULES.email, 'MX record'),
    hosting: matchList(ns, RULES.hosting, 'NS record'),
    cdn: [...matchList(cname, RULES.cdn, 'CNAME record'), ...matchList([html], RULES.cdn, 'website source')].filter((v, i, all) => all.findIndex((x) => x.name === v.name) === i),
    analytics,
    crmMarketing: [...thirdParty, ...matchList([html], RULES.crm, 'website source')].filter((v, i, all) => all.findIndex((x) => x.name === v.name) === i),
    thirdPartyServices: [...verification, ...thirdParty].filter((v, i, all) => all.findIndex((x) => x.name === v.name) === i),
  };
}

module.exports = { RULES, detectTech };
