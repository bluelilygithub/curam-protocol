'use strict';

// Where everything stands in one check (rework brief, decisions 1-4). Pure. Decisions belong to the job, not to a round: a request line's
// Approve / Question, and an unrequested change's Mine, intentional / Question / Expected, keyed by the change's fingerprint (diff.js), so
// they carry over to later checks.
//   attention   Needs attention: unrequested changes not yet marked, questioned ones, request lines with no change found (or not matched),
//               questioned lines, lines approved earlier whose changes have gone or changed since ("was approved, now changed"), and
//               Keep lines whose text changed.
//   approve     To approve: request lines with linked changes and no decision yet; held-over lines and Keep lines that could not be
//               checked are listed here too but never block.
//   approved    Approved (shown collapsed): approved lines whose changes are the same as when approved, kept Keep lines, and changes marked
//               Mine, intentional or Expected.
// A change that looks like it changes by itself (c.volatile) and has no decision counts as Expected automatically (autoExpected).
// Ready to send: nothing in attention and no undecided request line in approve.

const LINE_STATUS = new Set(['approved', 'question']);
const CHANGE_STATUS = new Set(['mine', 'question', 'expected']);
const changeKey = (pageId, fp) => `${pageId}|${fp}`;
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * pages: [{ pageId, changes (vs the starting point, each with id and fp), matches (results.matches or null), prevFps (Set of the
 *          fingerprints at the previous check of this page, or null when this is its first check) }]
 * items: the job's lines; lines: lineStatuses() output ([{ ref, kind, status, links: [{ pageId, changeId }] }]);
 * decisions: { lines: { ref: { status, note, fps } }, changes: { 'pageId|fp': { status, note } } }
 */
function reviewState({ items, pages, lines, decisions }) {
  const changeOf = new Map(); // pageId|changeId -> change
  for (const p of pages) for (const c of p.changes || []) changeOf.set(`${p.pageId}|${c.id}`, c);
  const isNew = (p, c) => Boolean(p.prevFps) && !p.prevFps.has(c.fp);
  const pageOfFp = new Map(pages.flatMap((p) => (p.changes || []).map((c) => [c.fp, p])));
  const statusOf = Object.fromEntries((lines || []).map((l) => [l.ref, l]));
  const out = { attention: [], approve: [], approved: [] };
  const linkedFps = new Set();

  for (const it of items) {
    const kind = it.kind || 'request_line';
    const st = statusOf[it.ref] || { status: 'notMatched' };
    const links = (st.links || []).map((l) => {
      const c = changeOf.get(`${l.pageId}|${l.changeId}`);
      return c ? { pageId: l.pageId, changeId: l.changeId, fp: c.fp, isNew: isNew(pageOfFp.get(c.fp), c) } : null;
    }).filter(Boolean);
    for (const l of links) linkedFps.add(l.fp);
    const base = { type: 'line', ref: it.ref, kind, status: st.status, links };
    if (kind === 'held_over') { out.approve.push({ ...base, reason: 'held', blocking: false }); continue; }
    if (kind === 'keep') {
      if (st.status === 'keepChanged') out.attention.push({ ...base, reason: 'keepChanged' });
      else if (st.status === 'kept') out.approved.push({ ...base, reason: 'kept' });
      else out.approve.push({ ...base, reason: st.status, blocking: false });
      continue;
    }
    const d = decisions.lines?.[it.ref];
    const decision = d && LINE_STATUS.has(d.status) ? { status: d.status, note: d.note || null } : null;
    const fps = links.map((l) => l.fp);
    if (decision?.status === 'question') { out.attention.push({ ...base, decision, reason: 'questioned' }); continue; }
    if (decision?.status === 'approved') {
      // decisions moved over from the old per-round approvals have no fingerprints: taken as approved against what is linked now
      if (!Array.isArray(d.fps) || (fps.length && sameSet(d.fps, fps))) out.approved.push({ ...base, decision, reason: 'approved' });
      else out.attention.push({ ...base, decision, reason: 'changedSinceApproval' });
      continue;
    }
    if (st.status === 'linked' && links.length) out.approve.push({ ...base, decision: null, reason: 'looksDone', blocking: true });
    else out.attention.push({ ...base, decision: null, reason: st.status === 'notMatched' ? 'notMatched' : 'noChange' });
  }

  let autoExpected = 0;
  for (const p of pages) {
    for (const c of p.changes || []) {
      if (linkedFps.has(c.fp)) continue;
      const d = decisions.changes?.[changeKey(p.pageId, c.fp)];
      const decision = d && CHANGE_STATUS.has(d.status) ? { status: d.status, note: d.note || null, auto: false } : (c.volatile ? { status: 'expected', note: null, auto: true } : null);
      if (decision?.auto) autoExpected++;
      const row = { type: 'change', pageId: p.pageId, changeId: c.id, fp: c.fp, volatile: c.volatile || null, isNew: isNew(p, c), decision };
      if (!decision) out.attention.push({ ...row, reason: 'unmarked' });
      else if (decision.status === 'question') out.attention.push({ ...row, reason: 'questioned' });
      else out.approved.push({ ...row, reason: decision.status });
    }
  }
  // unrequested changes first within Needs attention (brief decision 2), then the lines
  out.attention.sort((a, b) => (a.type === b.type ? 0 : a.type === 'change' ? -1 : 1));
  const blocking = out.approve.filter((x) => x.blocking).length;
  return {
    ...out,
    counts: { attention: out.attention.length, toApprove: blocking, approved: out.approved.length, autoExpected },
    ready: out.attention.length === 0 && blocking === 0,
  };
}

module.exports = { reviewState, changeKey, LINE_STATUS, CHANGE_STATUS };
