'use strict';

// Plain-words checks on a domain's email records (MX, SPF, DMARC). Pure: give it the records, get a list of findings. It reads the
// records only; it cannot tell whether mail really gets through. level: good | warn | bad | info.

const SPF_LOOKUP_LIMIT = 10;

function isCloudflareRouting(host) {
  return /(^|\.)mx\.cloudflare\.net\.?$/i.test(host);
}

function spfLookupCount(spf) {
  return spf.split(/\s+/).slice(1).filter((t) => /^[+\-~?]?(include:|a(:|\/|$)|mx(:|\/|$)|ptr(:|$)|exists:|redirect=)/i.test(t)).length;
}

function mxFindings(mxRecords) {
  if (!mxRecords.length) {
    return [{ id: 'mx', level: 'bad', title: 'No mail servers (MX)', detail: 'Nothing is set up to receive email for this name, so mail sent to it has nowhere to go.' }];
  }
  const hosts = mxRecords.map((r) => r.value);
  const out = [{ id: 'mx', level: 'good', title: `Mail servers found (${hosts.length})`, detail: hosts.join(', ') }];
  if (hosts.every(isCloudflareRouting)) {
    out.push({ id: 'mx-cloudflare', level: 'info', title: 'Mail goes through Cloudflare Email Routing', detail: 'This is what Burner Mail needs. Where it ends up depends on the routing rules in Cloudflare.' });
  } else if (hosts.some(isCloudflareRouting)) {
    out.push({ id: 'mx-mixed', level: 'warn', title: 'Cloudflare Email Routing is mixed with other mail servers', detail: 'Some mail will go to Cloudflare and some elsewhere. For Burner Mail, remove the other MX records.' });
  }
  return out;
}

function spfFindings(txtRecords) {
  const spfs = txtRecords.map((r) => r.value).filter((v) => /^v=spf1(\s|$)/i.test(v));
  if (!spfs.length) {
    return [{ id: 'spf', level: 'warn', title: 'No SPF record', detail: 'SPF tells receiving servers which servers may send mail for this name. Without it, mail sent from this name is more likely to be treated as junk.' }];
  }
  if (spfs.length > 1) {
    return [{ id: 'spf', level: 'bad', title: 'More than one SPF record', detail: 'A name may have only one. With two, SPF fails for every message. Merge them into one record.' }];
  }
  const spf = spfs[0];
  const out = [];
  const all = spf.match(/\s([+\-~?]?)all(\s|$)/i);
  if (!all) out.push({ id: 'spf', level: 'warn', title: 'SPF has no "all" ending', detail: `${spf} — it should end in -all or ~all so unlisted senders are not trusted.` });
  else if (all[1] === '-') out.push({ id: 'spf', level: 'good', title: 'SPF is set, strict (-all)', detail: spf });
  else if (all[1] === '~' ) out.push({ id: 'spf', level: 'good', title: 'SPF is set, soft fail (~all)', detail: spf });
  else out.push({ id: 'spf', level: 'bad', title: 'SPF lets anyone send (+all or ?all)', detail: `${spf} — this gives no protection.` });
  const n = spfLookupCount(spf);
  if (n > SPF_LOOKUP_LIMIT) out.push({ id: 'spf-lookups', level: 'bad', title: `SPF needs about ${n} lookups`, detail: `The limit is ${SPF_LOOKUP_LIMIT}. Over it, SPF fails. Remove includes you do not use.` });
  return out;
}

function dmarcFindings(dmarcRecords) {
  const dmarcs = dmarcRecords.map((r) => r.value).filter((v) => /^v=DMARC1(\s*;|\s|$)/i.test(v));
  if (!dmarcs.length) {
    return [{ id: 'dmarc', level: 'warn', title: 'No DMARC record', detail: 'DMARC says what to do with mail that fails SPF or DKIM. Many large mail providers now expect it from anyone sending mail.' }];
  }
  if (dmarcs.length > 1) return [{ id: 'dmarc', level: 'bad', title: 'More than one DMARC record', detail: 'Keep only one.' }];
  const policy = (dmarcs[0].match(/;\s*p\s*=\s*([a-z]+)/i) || [])[1]?.toLowerCase();
  if (policy === 'reject' || policy === 'quarantine') return [{ id: 'dmarc', level: 'good', title: `DMARC is set (p=${policy})`, detail: dmarcs[0] }];
  if (policy === 'none') return [{ id: 'dmarc', level: 'info', title: 'DMARC is set to monitor only (p=none)', detail: `${dmarcs[0]} — a sensible start; it reports but does not block anything.` }];
  return [{ id: 'dmarc', level: 'warn', title: 'DMARC record has no clear policy', detail: dmarcs[0] }];
}

function emailChecks({ mx = [], txt = [], dmarc = [] } = {}) {
  return [...mxFindings(mx), ...spfFindings(txt), ...dmarcFindings(dmarc)];
}

module.exports = { emailChecks, spfLookupCount };
