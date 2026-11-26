'use strict';

// The client report (milestone 5): a fillable PDF checklist, grouped by page, for the client to review the edits the person approved.
// Built in two steps so the content can be tested without reading a PDF:
//   buildReportModel()  what goes in (pure): the approved request lines with their changes, held-over lines, Keep lines, and (on request)
//                       the changes nobody asked for, each in the section of its page
//   renderReportPdf()   the PDF, with pdf-lib (the library PDF Tools uses for its fillable forms); fields are left live, never flattened
// Field names carry the job and round, so a renamed or forwarded file still maps back (brief, "Field naming in the report"):
//   hcc_<job>_r<round>_<ref>_ok | _change | _note       per approved line: Looks right, Needs a change, notes
//   hcc_<job>_r<round>_p<page>_<changeId>_ok | _change | _note   per change nobody asked for (when included)
//   hcc_<job>_r<round>_change<n>_ref | _text | _wording  the Further changes table (n = 1 … 8)
//   hcc_<job>_r<round>_approved | _name | _date          Approved as is, name, date
//   hcc_job, hcc_round                                   hidden: which job and round this report is
// Only what the client should read is printed: no internal labels, ids or diff markup. Standard Helvetica (Latin-1 plus the usual
// quotes and dashes): any other character is printed as "?".

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const FURTHER_ROWS = 8;
const fieldBase = (jobId, round) => `hcc_${jobId}_r${round}`;
const fieldNames = {
  line: (jobId, round, ref, part) => `${fieldBase(jobId, round)}_${ref}_${part}`,
  unasked: (jobId, round, pageId, changeId, part) => `${fieldBase(jobId, round)}_p${pageId}_${changeId}_${part}`,
  further: (jobId, round, n, part) => `${fieldBase(jobId, round)}_change${n}_${part}`,
  final: (jobId, round, part) => `${fieldBase(jobId, round)}_${part}`,
};

// ── The model ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function changeView(c) {
  if (!c) return null;
  const side = c.after || c.before;
  const isImage = side?.type === 'image';
  const pic = (s) => `Picture: ${s.text ? `"${s.text}"` : 'no description'}${s.src ? ` (${s.src})` : ''}`;
  if (isImage) return { type: c.type, before: c.before ? pic(c.before) : null, after: c.after ? pic(c.after) : null, section: (side.section || []).join(' › ') };
  return {
    type: c.type, section: (side.section || []).join(' › '),
    ...(c.type === 'changed' ? { words: c.words } : {}),
    ...(c.type === 'added' ? { after: c.after.text } : {}),
    ...(c.type === 'removed' ? { before: c.before.text } : {}),
    ...(c.type === 'moved' ? { after: c.after.text } : {}),
  };
}

/**
 * job: the job row; pages: [{ id, label, url }] in order; items: the job's lines; view: the round view (routes: roundView) with
 * pages[].results.diff.vsBaseline and lines[]; approvals: { ref: { status, note } }; includeUnasked: add the changes nobody asked for.
 */
function buildReportModel({ job, pages, items, view, approvals, includeUnasked = false }) {
  const rowByPage = new Map(view.pages.map((r) => [r.pageId, r]));
  const changeOf = (pageId, id) => rowByPage.get(pageId)?.results?.diff?.vsBaseline?.changes?.find((c) => c.id === id);
  const lineOf = Object.fromEntries((view.lines || []).map((l) => [l.ref, l]));
  const pageLabel = (id, i = pages.findIndex((p) => p.id === id)) => (i < 0 ? 'A removed page' : pages[i].label || `Page ${i + 1}`);
  const sections = pages.map((p, i) => {
    const r = rowByPage.get(p.id);
    return { pageId: p.id, label: pageLabel(p.id, i), url: p.url, readAt: r?.fetchedAt || null, read: r?.status === 'ready', rows: [], held: [], keeps: [], unasked: [] };
  });
  const general = { pageId: null, label: 'Across the site', url: null, readAt: null, read: true, rows: [], held: [], keeps: [], unasked: [] };
  const sectionFor = (pageId) => sections.find((s) => s.pageId === pageId) || general;
  let notYet = 0;
  let needsWork = 0;
  for (const it of items) {
    const kind = it.kind || 'request_line';
    const st = lineOf[it.ref];
    if (kind === 'held_over') { sectionFor(it.pageId).held.push({ ref: it.ref, text: it.lineText }); continue; }
    if (kind === 'keep') { sectionFor(it.pageId ?? st?.pageIds?.[0]).keeps.push({ ref: it.ref, text: it.lineText, status: st?.status || 'keepNotRead' }); continue; }
    const ap = approvals[it.ref]?.status;
    if (ap === 'needs_work') { needsWork++; continue; }
    if (ap !== 'approved') { notYet++; continue; }
    const links = st?.links || [];
    const home = it.pageId ?? links[0]?.pageId ?? null;
    const changes = links.map((l) => ({ ...changeView(changeOf(l.pageId, l.changeId)), page: l.pageId !== home ? pageLabel(l.pageId) : null })).filter((c) => c.type);
    sectionFor(home).rows.push({ ref: it.ref, text: it.lineText, changes });
  }
  if (includeUnasked) {
    for (const s of sections) {
      const r = rowByPage.get(s.pageId);
      const all = r?.results?.diff?.vsBaseline?.changes || [];
      const linked = new Set((view.lines || []).flatMap((l) => (l.links || []).filter((x) => x.pageId === s.pageId).map((x) => x.changeId)));
      s.unasked = all.filter((c) => !c.volatile && !linked.has(c.id)).map((c) => ({ id: c.id, ...changeView(c) }));
    }
  }
  const used = [...sections, general].filter((s) => s.rows.length || s.held.length || s.keeps.length || s.unasked.length);
  return {
    jobId: job.id, round: view.number, title: job.name, readAt: view.fetchedAt, sections: used, notYet, needsWork,
    approvedCount: used.reduce((n, s) => n + s.rows.length, 0), includeUnasked,
  };
}

// ── The PDF ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const A4 = [595.28, 841.89];
const M = 48;
const INK = rgb(0.1, 0.1, 0.1);
const MUTED = rgb(0.4, 0.4, 0.4);
const RED = rgb(0.6, 0.1, 0.1);
const GREEN = rgb(0.08, 0.4, 0.2);
const LINE = rgb(0.8, 0.8, 0.78);
const KEEP_TEXT = {
  kept: 'Kept as asked: still on the page, word for word.',
  keepChanged: 'Changed or removed, although it was meant to stay.',
  keepNotOnStartingPage: 'Not found word for word on the page, so it could not be checked.',
  keepNotRead: 'The page was not read in this round.',
};
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

async function renderReportPdf(model) {
  const doc = await PDFDocument.create();
  doc.setTitle(`${model.title}: changes for review`);
  doc.setCreator('Vault HTML Content Check');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const ok = new Map();
  // a character Helvetica cannot draw is printed as "?" rather than failing the whole report
  const safe = (s) => [...String(s ?? '')].map((ch) => {
    if (!ok.has(ch)) { try { font.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); } }
    return ok.get(ch) ? ch : (/\s/.test(ch) ? ' ' : '?');
  }).join('').replace(/[\t\r\n]+/g, ' ');
  const W = A4[0] - 2 * M;
  let page;
  let y;
  const newPage = () => { page = doc.addPage(A4); y = A4[1] - M; };
  const need = (h) => { if (y - h < M + 30) newPage(); };
  newPage();

  // text that wraps; `parts` are [{ text, style: 'same' | 'del' | 'ins' }]
  function flow(parts, { size = 10, x = M, width = W, f = font, color = INK } = {}) {
    const lh = size * 1.35;
    const words = [];
    for (const p of parts) for (const w of safe(p.text).split(/(\s+)/).filter(Boolean)) words.push({ w, style: p.style || 'same' });
    let cx = x;
    need(lh); y -= lh;
    for (const { w, style } of words) {
      const isSpace = /^\s+$/.test(w);
      const tw = f.widthOfTextAtSize(isSpace ? ' ' : w, size);
      if (!isSpace && cx + tw > x + width && cx > x) { need(lh); y -= lh; cx = x; }
      if (isSpace) { if (cx > x) cx += tw; continue; }
      const col = style === 'del' ? RED : style === 'ins' ? GREEN : color;
      page.drawText(w, { x: cx, y, size, font: f, color: col });
      if (style === 'del') page.drawLine({ start: { x: cx, y: y + size * 0.32 }, end: { x: cx + tw, y: y + size * 0.32 }, thickness: 0.7, color: RED });
      if (style === 'ins') page.drawLine({ start: { x: cx, y: y - 1.5 }, end: { x: cx + tw, y: y - 1.5 }, thickness: 0.6, color: GREEN });
      cx += tw;
    }
  }
  const text = (s, opts) => flow([{ text: s }], opts);
  const gap = (h) => { y -= h; };
  const rule = () => { need(8); gap(4); page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 0.5, color: LINE }); gap(4); };
  const tick = (name, label, x) => {
    const box = form.createCheckBox(name);
    box.addToPage(page, { x, y: y - 2, width: 11, height: 11, borderColor: MUTED, borderWidth: 0.8 });
    page.drawText(safe(label), { x: x + 15, y, size: 9, font, color: INK });
  };
  const textField = (name, label, height) => {
    need(height + 16);
    if (label) { gap(12); page.drawText(safe(label), { x: M, y, size: 8, font, color: MUTED }); }
    gap(height + 3);
    const f = form.createTextField(name);
    if (height > 22) f.enableMultiline();
    f.addToPage(page, { x: M, y, width: W, height, borderColor: LINE, borderWidth: 0.8 });
    f.setFontSize(9);
  };
  const changeLines = (c) => {
    const where = [c.page ? `On ${c.page}` : null, c.section ? `under ${c.section}` : null].filter(Boolean).join(', ');
    if (where) text(where, { size: 8, color: MUTED });
    if (c.words) flow(c.words.flatMap((w, i) => [...(w.op === '+' && c.words[i - 1]?.op === '-' ? [{ text: ' ' }] : []), { text: w.text, style: w.op === '-' ? 'del' : w.op === '+' ? 'ins' : 'same' }])); // a space between taken-out and put-in words
    else if (c.type === 'added') flow([{ text: 'Added: ', style: 'same' }, { text: c.after, style: 'ins' }]);
    else if (c.type === 'removed') flow([{ text: 'Removed: ', style: 'same' }, { text: c.before, style: 'del' }]);
    else if (c.type === 'moved') flow([{ text: 'Moved to a new place: ' }, { text: c.after }]);
    else if (c.before || c.after) { if (c.before) flow([{ text: 'Before: ' }, { text: c.before, style: 'del' }]); if (c.after) flow([{ text: 'After: ' }, { text: c.after, style: 'ins' }]); }
    gap(3);
  };
  const reviewRow = (ref, line, changes, names) => {
    need(110);
    gap(6);
    flow([{ text: `${ref}  ` }, { text: line }], { f: bold, size: 10.5 });
    gap(2);
    if (!changes.length) text('No change was found on the page for this line.', { size: 9, color: MUTED });
    for (const c of changes) changeLines(c);
    need(20); gap(14);
    tick(names.ok, 'Looks right', M);
    tick(names.change, 'Needs a change', M + 110);
    textField(names.note, 'Notes', 34);
    rule();
  };

  // ---- header ----
  text(model.title, { f: bold, size: 16 });
  gap(2);
  text(`Changes for your review · Round ${model.round}`, { size: 11, color: MUTED });
  text(`This shows the pages as they were on ${fmtDate(model.readAt)}.`, { size: 10 });
  gap(4);
  text('For each change: tick Looks right or Needs a change, and add a note if you like. Words struck through in red were taken out; words underlined in green were put in.', { size: 9, color: MUTED });
  rule();

  for (const s of model.sections) {
    need(60); gap(8);
    text(s.label, { f: bold, size: 13 });
    if (s.url) text(`${s.url}${s.readAt ? ` · read ${fmtDate(s.readAt)}` : ''}`, { size: 8, color: MUTED });
    gap(2);
    for (const r of s.rows) reviewRow(r.ref, r.text, r.changes, { ok: fieldNames.line(model.jobId, model.round, r.ref, 'ok'), change: fieldNames.line(model.jobId, model.round, r.ref, 'change'), note: fieldNames.line(model.jobId, model.round, r.ref, 'note') });
    if (s.unasked.length) {
      need(30); gap(8); text('Other changes on this page', { f: bold, size: 11 });
      text('These changes were not in the request. Tick whether each is fine.', { size: 9, color: MUTED });
      for (const c of s.unasked) {
        need(100); gap(6);
        changeLines(c);
        need(20); gap(12);
        tick(fieldNames.unasked(model.jobId, model.round, s.pageId, c.id, 'ok'), 'Fine to keep', M);
        tick(fieldNames.unasked(model.jobId, model.round, s.pageId, c.id, 'change'), 'Needs a change', M + 110);
        textField(fieldNames.unasked(model.jobId, model.round, s.pageId, c.id, 'note'), 'Notes', 30);
        rule();
      }
    }
    if (s.keeps.length) {
      need(30); gap(6); text('Text you asked us to keep', { f: bold, size: 11 });
      for (const k of s.keeps) { flow([{ text: `${k.ref}  ` }, { text: k.text }], { size: 9.5 }); text(KEEP_TEXT[k.status] || '', { size: 8.5, color: k.status === 'keepChanged' ? RED : MUTED }); gap(3); }
    }
    if (s.held.length) {
      need(30); gap(6); text('Held over (not checked yet)', { f: bold, size: 11 });
      for (const h of s.held) { flow([{ text: `${h.ref}  ` }, { text: h.text }], { size: 9.5, color: MUTED }); gap(3); }
    }
  }
  if (!model.sections.length) text('No changes have been approved for review in this round yet.', { size: 10, color: MUTED });

  // ---- further changes ----
  need(80); gap(14);
  text('Further changes', { f: bold, size: 13 });
  text('Anything else you would like changed. Quote the R number if it relates to one above.', { size: 9, color: MUTED });
  const cols = [['Refers to', 56], ['What should change', (W - 56) * 0.5], ['New wording', (W - 56) * 0.5]];
  need(20); gap(14);
  let cx = M;
  for (const [h, w] of cols) { page.drawText(h, { x: cx, y, size: 8, font: bold, color: MUTED }); cx += w; }
  for (let n = 1; n <= FURTHER_ROWS; n++) {
    need(30); gap(28);
    page.drawText(`${n}`, { x: M - 12, y: y + 8, size: 8, font, color: MUTED });
    cx = M;
    for (const [part, i] of [['ref', 0], ['text', 1], ['wording', 2]]) {
      const f = form.createTextField(fieldNames.further(model.jobId, model.round, n, part));
      if (part !== 'ref') f.enableMultiline();
      f.addToPage(page, { x: cx, y, width: cols[i][1] - 4, height: 24, borderColor: LINE, borderWidth: 0.8 });
      f.setFontSize(8.5);
      cx += cols[i][1];
    }
  }

  // ---- sign-off ----
  need(110); gap(22);
  text('Sign-off', { f: bold, size: 13 });
  need(20); gap(16);
  tick(fieldNames.final(model.jobId, model.round, 'approved'), 'Approved as is: no further changes needed', M);
  textField(fieldNames.final(model.jobId, model.round, 'name'), 'Name', 20);
  textField(fieldNames.final(model.jobId, model.round, 'date'), 'Date', 20);

  // ---- hidden: which job and round this is ----
  for (const [name, value] of [['hcc_job', String(model.jobId)], ['hcc_round', String(model.round)]]) {
    const f = form.createTextField(name);
    f.setText(value);
    f.addToPage(doc.getPage(0), { x: 0, y: 0, width: 1, height: 1, hidden: true, borderWidth: 0 });
  }

  // ---- footer on every page ----
  const pagesAll = doc.getPages();
  pagesAll.forEach((p, i) => {
    p.drawText('Fill in on a computer, or print, write and scan. Quote the R number for each change.', { x: M, y: 24, size: 7.5, font, color: MUTED });
    p.drawText(`Page ${i + 1} of ${pagesAll.length}`, { x: A4[0] - M - 50, y: 24, size: 7.5, font, color: MUTED });
  });
  form.updateFieldAppearances(font);
  return doc.save();
}

module.exports = { buildReportModel, renderReportPdf, fieldNames, FURTHER_ROWS };
