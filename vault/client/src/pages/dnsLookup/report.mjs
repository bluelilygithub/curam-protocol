// DNS Lookup's export: one saved lookup -> a report page (.html, opens in any browser and prints to PDF) or a .csv. Pure, so
// report.test.mjs can check it. `item` is a dns_lookups row: { kind: 'records' | 'email', name, resolver, createdAt, result }.
// For 'records' result is { answer, about }; for 'email' it is the email check's answer { name, findings }.

const RESOLVER_LABEL = { cloudflare: 'Cloudflare (1.1.1.1)', google: 'Google (8.8.8.8)' };
const LEVEL_WORD = { good: 'Good', warn: 'Worth a look', bad: 'Problem', info: 'Note' };

// The "who hosts it / who registered it" lines, as [label, value]. The page shows the same lines.
export function aboutLines(about) {
  if (!about) return [];
  const lines = [];
  const h = about.hosting;
  if (h === null) lines.push(['Hosted by', 'No address found, so no host to name.']);
  else if (h?.error) lines.push(['Hosted by', h.error]);
  else if (h) {
    const who = [h.organisation, h.network && h.network !== h.organisation ? `network ${h.network}` : null].filter(Boolean).join(', ') || 'Unknown';
    lines.push(['Hosted by', h.proxy ? `${who}. This is a proxy or CDN in front of the site, so the real server behind it is hidden.` : who]);
    lines.push(['Address checked', h.ip]);
    if (h.reverseName) lines.push(['Reverse name', h.reverseName]);
  }
  const r = about.registrar;
  if (r?.error) lines.push(['Registrar', r.error]);
  else if (r) {
    lines.push(['Registrar', r.name || 'Not given by the registry']);
    if (r.registered) lines.push(['Registered', r.registered]);
    if (r.expires) lines.push(['Expires', r.expires]);
    if (r.domain) lines.push(['Domain checked', r.domain]);
  }
  return lines;
}

function when(item) {
  const d = new Date(item.createdAt || Date.now());
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-AU');
}

function recordValue(r) {
  return `${r.priority !== undefined ? `priority ${r.priority} · ` : ''}${r.value}${r.ttl !== undefined ? ` · TTL ${r.ttl}s` : ''}`;
}

export function reportFilename(item, ext) {
  const day = new Date(item.createdAt || Date.now()).toISOString().slice(0, 10);
  const slug = String(item.name || 'lookup').toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
  return `dns-${item.kind === 'email' ? 'email-' : ''}${slug}-${day}.${ext}`;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function reportCsv(item) {
  const rows = [['Section', 'Item', 'Value', 'TTL', 'Priority']];
  if (item.kind === 'email') {
    for (const f of item.result?.findings || []) rows.push(['Email setup', `${LEVEL_WORD[f.level] || f.level}: ${f.title}`, f.detail, '', '']);
  } else {
    for (const [label, value] of aboutLines(item.result?.about)) rows.push(['Host and registrar', label, value, '', '']);
    for (const block of item.result?.answer?.results || []) {
      if (block.error) rows.push(['Records', block.type, block.error, '', '']);
      else if (!block.records.length) rows.push(['Records', block.type, 'None found', '', '']);
      for (const r of block.records) rows.push(['Records', block.type, r.value, r.ttl ?? '', r.priority ?? '']);
    }
  }
  return `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function reportHtml(item) {
  const title = item.kind === 'email' ? `Email setup for ${item.name}` : `DNS report for ${item.name}`;
  const parts = [];
  if (item.kind === 'email') {
    parts.push('<h2>Findings</h2>');
    for (const f of item.result?.findings || []) {
      parts.push(`<div class="finding"><b>${esc(LEVEL_WORD[f.level] || f.level)}:</b> ${esc(f.title)}<div class="muted">${esc(f.detail)}</div></div>`);
    }
    parts.push('<p class="muted">This reads the records only; it cannot tell whether an email will really arrive.</p>');
  } else {
    const about = aboutLines(item.result?.about);
    if (about.length) {
      parts.push('<h2>Host and registrar</h2><table>');
      for (const [k, v] of about) parts.push(`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`);
      parts.push('</table>');
    }
    const answer = item.result?.answer || {};
    parts.push(`<h2>Records</h2>${answer.compare ? '<p class="muted">Cloudflare and Google compared; the values shown are Cloudflare\'s.</p>' : ''}<table>`);
    for (const block of answer.results || []) {
      const verdict = answer.compare?.verdicts?.[block.type];
      const note = verdict && verdict.same !== null ? ` <span class="muted">(${verdict.same ? 'same on both' : 'differs between Cloudflare and Google'})</span>` : '';
      const values = block.error ? esc(block.error) : (block.records.length ? block.records.map((r) => esc(recordValue(r))).join('<br>') : '<span class="muted">None found</span>');
      parts.push(`<tr><th>${esc(block.type)}${note}</th><td class="mono">${values}</td></tr>`);
    }
    parts.push('</table>');
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1a1a1a;max-width:860px;margin:32px auto;padding:0 20px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:6px 8px;border-bottom:1px solid #f0f0f0}
th{width:200px;font-weight:600}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}
.muted{color:#6b7280;font-weight:400}.finding{margin:0 0 10px}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">Looked up ${esc(when(item))}${item.resolver ? ` · asked ${esc(RESOLVER_LABEL[item.resolver] || item.resolver)}` : ''} · Curam Vault DNS Lookup</p>
${parts.join('\n')}
</body></html>
`;
}
