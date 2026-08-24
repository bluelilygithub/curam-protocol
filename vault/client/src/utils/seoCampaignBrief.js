function formatRunDate(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url || 'site'; }
}

/** Markdown brief for an SEO manager (indexation, SERP copy, content, internal links). */
export function formatSeoCampaignBrief(audit) {
  const report = audit?.report || {};
  const date = formatRunDate(audit?.createdAt);
  const pages = report.pages || [];
  const globalUpdates = report.globalUpdates || [];
  const findings = report.findings || [];
  const crawled = Number(report.crawled) || pages.length;
  const discovered = Number(report.discovered) || pages.length;
  const lines = [
    `# SEO campaign brief${date ? ` (${date})` : ''}`,
    `Site: ${audit?.url || ''}`,
    `Name: ${audit?.name || ''}`,
    `Score ${audit?.score ?? '—'} · crawled ${crawled}${discovered > crawled ? ` of ${discovered} found` : ''}`,
    '',
    'This crawl is for organic campaigns: which URLs can rank, how they look in SERPs, thin/duplicate content, and internal links.',
    'Page speed and Core Web Vitals are in HTML (Lighthouse). Paid keywords are in Adwords.',
    '',
    '## Campaign work order',
  ];
  if (!globalUpdates.length) {
    lines.push('- No site-wide tickets. Check per-URL recommendations below.');
  } else {
    for (const u of globalUpdates) {
      lines.push(`### ${String(u.severity || 'warn').toUpperCase()} — ${u.applyIn || 'Site-wide'}`);
      lines.push(u.action || '');
      if (u.why) lines.push(u.why);
      if (u.pagesAffected) lines.push(`Affects ${u.pagesAffected}${u.totalPages ? ` of ${u.totalPages}` : ''} crawled pages.`);
      lines.push('');
    }
  }
  lines.push('## Indexation and site findings');
  if (!findings.length) lines.push('- None');
  for (const f of findings) {
    lines.push(`- **${f.severity}** ${f.title}${f.detail ? ` — ${f.detail}` : ''}`);
  }
  lines.push('', '## Pages (SERP copy and on-page)');
  for (const p of pages) {
    const recs = p.recommendations || [];
    lines.push(`### ${p.title || p.url} (${p.score ?? '—'})`);
    lines.push(p.url);
    if (p.depth != null || p.titleChars) {
      lines.push(`Click depth ${p.depth ?? '—'} · title ${p.titleChars || '—'} chars`);
    }
    if (!recs.length) {
      lines.push('- No campaign fixes on this URL.');
    } else {
      for (const r of recs) {
        lines.push(`- **${r.severity}** ${r.action}${r.why ? ` (${r.why})` : ''}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

export function seoBriefFilename(audit) {
  const day = formatRunDate(audit?.createdAt).replace(/\s+/g, '-').toLowerCase() || 'audit';
  return `seo-${hostOf(audit?.url)}-${day}.md`;
}

export { formatRunDate };
