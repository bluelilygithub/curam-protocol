// Review by line (ReviewView.jsx): how request lines are grouped for review, and the list of lines that need work for the developer.
// Plain functions, tested by reviewList.test.mjs.

/** The text the developer gets for the lines that need work, page by page. */
export function developerList({ jobName, number, groups, approvals }) {
  const out = [`Changes still needed: ${jobName}, round ${number}`, ''];
  for (const g of groups) {
    const lines = g.lines.filter((it) => approvals[it.ref]?.status === 'needs_work');
    if (!lines.length) continue;
    out.push(g.url ? `${g.label} (${g.url})` : g.label);
    for (const it of lines) {
      out.push(`- ${it.ref}: ${it.lineText}`);
      if (approvals[it.ref]?.note) out.push(`  Note: ${approvals[it.ref].note}`);
    }
    out.push('');
  }
  return out.join('\n').trim();
}

/** Request lines grouped for review: a line on a page under that page; a line with no page under the page of its first linked change,
 * else under "Across the site" (first). Held over and Keep lines are kept apart. */
export function reviewGroups(job, lines) {
  const pages = job.pages || [];
  const statusOf = Object.fromEntries(lines.map((l) => [l.ref, l]));
  const groups = [{ pageId: null, label: 'Across the site', url: null, lines: [] }, ...pages.map((p, i) => ({ pageId: p.id, label: p.label || `Page ${i + 1}`, url: p.url, lines: [] }))];
  const others = [];
  for (const it of job.items) {
    if ((it.kind || 'request_line') !== 'request_line') { others.push(it); continue; }
    const home = it.pageId ?? statusOf[it.ref]?.links?.[0]?.pageId ?? null;
    (groups.find((g) => g.pageId === home) || groups[0]).lines.push(it);
  }
  return { groups: groups.filter((g) => g.lines.length), others };
}
