'use strict';

// BIP stage 1: the DNS half is the same service the /dns-lookup tool uses. No duplicate resolver or record parsing here.

const lookup = require('../dnsLookup/lookup');

function values(records) {
  return (Array.isArray(records) ? records : []).map((r) => r.value).filter(Boolean);
}

/** Read the records BIP needs and keep the DNS tool's { type, records, error } shape for the raw source row. */
async function lookupDns(domain, deps = {}) {
  const { normalizeInput, lookupRecords, lookupEmailParts } = deps.dnsLib || lookup;
  const input = normalizeInput(domain);
  if (input.error) throw new Error(input.error);
  const name = input.name || domain;
  const [records, email] = await Promise.all([
    lookupRecords('cloudflare', name, ['A', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA']),
    lookupEmailParts('cloudflare', name),
  ]);
  const byType = {};
  for (const r of records || []) {
    byType[r.type] = { type: r.type, records: r.records || [], error: r.error || null };
  }
  if (email?.dmarc) byType.DMARC = { type: 'DMARC', records: email.dmarc.records || [], error: email.dmarc.error || null };
  return {
    domain: name,
    resolver: 'cloudflare',
    A: values(byType.A?.records),
    CNAME: values(byType.CNAME?.records),
    MX: values(byType.MX?.records),
    NS: values(byType.NS?.records),
    TXT: values(byType.TXT?.records),
    SOA: values(byType.SOA?.records),
    CAA: values(byType.CAA?.records),
    records: Object.values(byType),
    raw: { records, email },
  };
}

module.exports = { lookupDns, values };
