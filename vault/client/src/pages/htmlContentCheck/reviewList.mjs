// The review screen's plain helpers (ReviewView.jsx), tested by reviewList.test.mjs.

/** One change as plain text: what the block said before and says now. */
export function changeText(c) {
  if (!c) return '';
  const pic = (s) => `picture ${s.src || ''}${s.text ? ` ("${s.text}")` : ''}`.trim();
  const t = (s) => (s?.type === 'image' ? pic(s) : `"${s?.text || ''}"`);
  if (c.type === 'changed') return `${t(c.before)} became ${t(c.after)}`;
  if (c.type === 'added') return `Added ${t(c.after)}`;
  if (c.type === 'removed') return `Removed ${t(c.before)}`;
  if (c.type === 'moved') return `Moved ${t(c.after)}`;
  return '';
}

const WHY = {
  noChange: 'No change was found on the page for this request.',
  notMatched: 'Not checked yet.',
  changedSinceApproval: 'This was approved, but the change has gone or changed since.',
  keepChanged: 'This text was meant to stay as it is, but it changed or was removed.',
};

/**
 * "Copy the open questions": a prompt to paste straight into an LLM (or a message), asking for the open items to be fixed on the live
 * site. Open items: request lines questioned, with no change found, or changed since approval; Keep lines that changed; unrequested
 * changes marked Question. Page by page, with notes.
 * view: the round view ({ pages: [{ pageId, label, url, results: { diff } }], review }); items: the job's lines.
 */
export function openQuestionsPrompt({ jobName, items, view }) {
  const review = view?.review;
  if (!review) return '';
  const rows = view.pages || [];
  const pageLabel = (id, i = rows.findIndex((r) => r.pageId === id)) => (i < 0 ? 'Across the site' : rows[i].label || `Page ${i + 1}`);
  const changeOf = (pageId, id) => rows.find((r) => r.pageId === pageId)?.results?.diff?.vsBaseline?.changes?.find((c) => c.id === id);
  const textOf = Object.fromEntries(items.map((it) => [it.ref, it]));
  const byPage = new Map();
  const add = (pageId, line) => { if (!byPage.has(pageId)) byPage.set(pageId, []); byPage.get(pageId).push(line); };
  for (const x of review.attention) {
    if (x.type === 'line') {
      if (x.reason === 'notMatched') continue;
      const it = textOf[x.ref];
      const out = [`- Request ${x.ref}: "${it?.lineText || ''}"`];
      out.push(`  Problem: ${x.decision?.note || WHY[x.reason] || 'Questioned.'}`);
      for (const l of x.links || []) out.push(`  What the page shows now: ${changeText(changeOf(l.pageId, l.changeId))}`);
      add(it?.pageId ?? x.links?.[0]?.pageId ?? null, out.join('\n'));
    } else if (x.reason === 'questioned') {
      const out = [`- A change nobody asked for: ${changeText(changeOf(x.pageId, x.changeId))}`];
      out.push(`  Problem: ${x.decision?.note || 'Not requested: put it back as it was unless there is a reason for it.'}`);
      add(x.pageId, out.join('\n'));
    }
  }
  if (!byPage.size) return '';
  const head = [`I'm checking edits on a website (${jobName}) against what the client asked for. These items are still open. Please fix each one on the live pages and change nothing else.`, ''];
  const ordered = [...byPage.keys()].sort((a, b) => (a === null ? -1 : b === null ? 1 : rows.findIndex((r) => r.pageId === a) - rows.findIndex((r) => r.pageId === b)));
  const body = ordered.flatMap((id) => {
    const row = rows.find((r) => r.pageId === id);
    return [`Page: ${pageLabel(id)}${row?.url ? ` (${row.url})` : ''}`, ...byPage.get(id), ''];
  });
  return [...head, ...body].join('\n').trim();
}
