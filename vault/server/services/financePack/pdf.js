'use strict';

// Renders the financial-year pack as one landscape A4 PDF: cover, contents, then each report in turn.
// Generic over the normalized report shape, so every report (and any added later) is laid out the same.

const React = require('react');
const h = React.createElement;

const INK = '#1F2937', MUTED = '#6B7280', LINE = '#D1D5DB', SOFT = '#F3F4F6', ACCENT = '#9A5B1E', RED = '#B91C1C';

// The built-in Helvetica has the Windows-1252 glyphs only; anything else (arrows, maths symbols) would
// print as a stray mark, so swap or drop it.
const SWAPS = { 0x2192: '>', 0x2190: '<', 0x2265: '>=', 0x2264: '<=', 0x2212: '-' };
const KEEP = new Set([0x09, 0x0a, 0x0d, 0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2026, 0x20ac]);
const clean = (v) => Array.from(String(v ?? '')).map((ch) => {
  const c = ch.codePointAt(0);
  if (SWAPS[c]) return SWAPS[c];
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || KEEP.has(c) ? ch : '?';
}).join('');

const fmtMoney = (n) => {
  const v = parseFloat(n);
  if (Number.isNaN(v)) return '';
  const abs = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return v < 0 ? `-$${abs}` : `$${abs}`;
};
const fmtDate = (d) => {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}/${m}/${y}` : s;
};
function fmtCell(v, format) {
  if (v === null || v === undefined || v === '') return '';
  switch (format) {
    case 'money': return fmtMoney(v);
    case 'int': return String(Math.round(Number(v) || 0));
    case 'num': return (Number(v) || 0).toFixed(1);
    case 'pct': return `${(Number(v) || 0).toFixed(1)}%`;
    case 'date': return fmtDate(v);
    case 'datetime': return `${fmtDate(v)} ${String(new Date(v).toISOString()).slice(11, 16)}`;
    default: return clean(v);
  }
}

// Column widths: numbers and dates are narrow and fixed; text columns share the rest, wide for descriptions.
function colStyle(c) {
  if (c.format === 'money') return { width: 66, textAlign: 'right' };
  if (c.format === 'date') return { width: 54 };
  if (c.format === 'datetime') return { width: 86 };
  if (c.format === 'int') return { width: 36, textAlign: 'right' };
  if (c.format === 'num' || c.format === 'pct') return { width: 44, textAlign: 'right' };
  const wide = /desc|detail|item|event|supports|what|title|account|name|note/i.test(`${c.key} ${c.label}`);
  return { flexGrow: wide ? 3 : 1.2, flexBasis: 0, minWidth: 40 };
}

function buildDocument(deps, pack) {
  const { Document, Page, View, Text, StyleSheet } = deps;
  const s = StyleSheet.create({
    page: { paddingTop: 34, paddingBottom: 38, paddingHorizontal: 34, fontFamily: 'Helvetica', fontSize: 8, color: INK },
    cover: { paddingTop: 80, paddingHorizontal: 60, fontFamily: 'Helvetica', color: INK },
    coverTitle: { fontSize: 26, fontFamily: 'Helvetica-Bold', color: ACCENT, marginBottom: 6 },
    coverBiz: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
    coverMeta: { fontSize: 10, color: MUTED, marginBottom: 2 },
    coverBox: { marginTop: 22, padding: 12, backgroundColor: SOFT, borderRadius: 4 },
    coverNote: { fontSize: 8.5, color: MUTED, marginTop: 6, lineHeight: 1.35 },
    h1: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
    sub: { fontSize: 9, color: MUTED, marginBottom: 6 },
    note: { fontSize: 7.5, color: MUTED, fontFamily: 'Helvetica-Oblique', marginBottom: 3, lineHeight: 1.35 },
    sumRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4, marginBottom: 6 },
    sumBox: { marginRight: 14, marginBottom: 4, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: SOFT, borderRadius: 3 },
    sumLabel: { fontSize: 6.5, color: MUTED, textTransform: 'uppercase' },
    sumVal: { fontSize: 10, fontFamily: 'Helvetica-Bold' },
    secTitle: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 3 },
    headRow: { flexDirection: 'row', borderBottomWidth: 1.2, borderBottomColor: INK, paddingBottom: 2, marginBottom: 1 },
    row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 2 },
    totRow: { flexDirection: 'row', borderTopWidth: 1.2, borderTopColor: INK, backgroundColor: SOFT, paddingVertical: 2.5 },
    cellHead: { fontSize: 6.8, fontFamily: 'Helvetica-Bold', color: MUTED, textTransform: 'uppercase', paddingRight: 5 },
    cell: { fontSize: 7.6, paddingRight: 5 },
    cellBold: { fontSize: 7.6, fontFamily: 'Helvetica-Bold', paddingRight: 5 },
    empty: { fontSize: 7.6, color: MUTED, paddingVertical: 3 },
    footer: { position: 'absolute', bottom: 16, left: 34, right: 34, flexDirection: 'row', justifyContent: 'space-between', fontSize: 7, color: MUTED },
    err: { fontSize: 9, color: RED, marginTop: 8 },
    tocRow: { flexDirection: 'row', paddingVertical: 1.6 },
    tocNo: { width: 22, color: MUTED }, tocGroup: { fontFamily: 'Helvetica-Bold', marginTop: 6, marginBottom: 2, fontSize: 9, color: ACCENT },
  });

  const footer = (label) => h(View, { style: s.footer, fixed: true },
    h(Text, null, clean(`${pack.cover.business} · FY ${pack.fy} · ${label}`)),
    h(Text, { render: ({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}` }),
  );

  const table = (sec, key) => {
    const cols = sec.columns;
    const head = h(View, { style: s.headRow, fixed: true, key: `${key}-h` },
      ...cols.map((c, i) => h(Text, { key: i, style: [s.cellHead, colStyle(c)] }, clean(c.label))));
    const rows = (sec.rows || []).map((r, ri) => h(View, { key: `${key}-r${ri}`, style: s.row, wrap: false },
      ...cols.map((c, i) => h(Text, { key: i, style: [r._bold ? s.cellBold : s.cell, colStyle(c)] }, fmtCell(r[c.key], c.format)))));
    const tot = sec.totals ? h(View, { key: `${key}-t`, style: s.totRow, wrap: false },
      ...cols.map((c, i) => h(Text, { key: i, style: [s.cellBold, colStyle(c)] }, fmtCell(sec.totals[c.key], c.format)))) : null;
    return h(View, { key, style: { marginBottom: 4 } },
      h(Text, { style: s.secTitle, minPresenceAhead: 70 }, clean(sec.title)),
      sec.note ? h(Text, { style: s.note }, clean(sec.note)) : null,
      head,
      (sec.rows || []).length ? rows : h(Text, { style: s.empty }, 'No data for this period.'),
      tot,
    );
  };

  const reportPage = (rep, no) => h(Page, { key: rep.key, size: 'A4', orientation: 'landscape', style: s.page },
    h(Text, { style: s.h1 }, clean(`${no}. ${rep.title}`)),
    rep.subtitle ? h(Text, { style: s.sub }, clean(rep.subtitle)) : null,
    rep.error ? h(Text, { style: s.err }, clean(`This report could not be produced: ${rep.error}`)) : null,
    ...(rep.notes || []).map((n, i) => h(Text, { key: `n${i}`, style: s.note }, clean(n))),
    (rep.summary || []).length ? h(View, { style: s.sumRow }, ...rep.summary.map((m, i) => h(View, { key: i, style: s.sumBox },
      h(Text, { style: s.sumLabel }, clean(m.label)), h(Text, { style: s.sumVal }, fmtCell(m.value, m.format))))) : null,
    ...(rep.sections || []).map((sec, i) => table(sec, `${rep.key}-s${i}`)),
    footer(rep.title),
  );

  // ---- cover + contents
  const c = pack.cover;
  const groups = [];
  pack.reports.forEach((r, i) => {
    let g = groups.find(x => x.name === r.group);
    if (!g) { g = { name: r.group, items: [] }; groups.push(g); }
    g.items.push({ no: i + 1, title: r.title, error: r.error });
  });

  const coverPage = h(Page, { size: 'A4', orientation: 'landscape', style: s.cover },
    h(Text, { style: s.coverTitle }, clean(c.title)),
    h(Text, { style: s.coverBiz }, clean(c.business)),
    c.abn ? h(Text, { style: s.coverMeta }, clean(`ABN ${c.abn}`)) : null,
    c.address ? h(Text, { style: s.coverMeta }, clean(c.address)) : null,
    h(Text, { style: [s.coverMeta, { marginTop: 8 }] }, `Period: ${fmtDate(pack.bounds.from)} to ${fmtDate(pack.bounds.to)}`),
    h(Text, { style: s.coverMeta }, clean(`GST: ${c.gstStatus} · ${c.gstBasis} basis`)),
    h(Text, { style: s.coverMeta }, `Generated ${c.generatedAt}`),
    h(View, { style: s.coverBox },
      c.itemsToCheck === null || c.itemsToCheck === undefined
        ? h(Text, { style: { fontSize: 10 } }, 'Items to check could not be worked out.')
        : h(Text, { style: { fontSize: 10, fontFamily: 'Helvetica-Bold', color: c.itemsToCheck ? RED : INK } }, c.itemsToCheck ? clean(`${c.itemsToCheck} item${c.itemsToCheck === 1 ? '' : 's'} flagged to check — see “Things to Review” (report 1).`) : 'Nothing flagged in “Things to Review”.'),
      ...c.notes.map((n, i) => h(Text, { key: i, style: s.coverNote }, clean(n))),
      ...(c.failed.length ? [h(Text, { key: 'f', style: [s.coverNote, { color: RED }] }, clean(`Not produced: ${c.failed.join(' | ')}`))] : []),
    ),
  );

  const tocPage = h(Page, { size: 'A4', orientation: 'landscape', style: s.page },
    h(Text, { style: s.h1 }, 'Contents'),
    ...groups.flatMap((g, gi) => [
      h(Text, { key: `g${gi}`, style: s.tocGroup }, g.name),
      ...g.items.map((it, ii) => h(View, { key: `g${gi}i${ii}`, style: s.tocRow },
        h(Text, { style: [s.cell, s.tocNo] }, `${it.no}.`), h(Text, { style: s.cell }, clean(it.error ? `${it.title} (not produced)` : it.title)))),
    ]),
    footer('Contents'),
  );

  return h(Document, { title: clean(`${c.business} — FY ${pack.fy}`), author: 'Vault', subject: 'Financial year pack' },
    coverPage, tocPage, ...pack.reports.map((r, i) => reportPage(r, i + 1)));
}

async function renderPackPdf(pack) {
  const deps = await import('@react-pdf/renderer');
  return deps.renderToBuffer(buildDocument(deps, pack));
}

module.exports = { renderPackPdf, fmtCell };
