import type { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { LayoutPage } from '../compare/layout';
import { newPdf } from './pdfFonts';
import { SECTION_STATUS_LABEL, stillCheck } from '../compare/sections';
import { ACCURACY_NOTE, VERDICT_TEXT, decisionsSummary, progress, reviewItems, summarySentence, verdictOf, type Decisions, type Verdict } from '../review/verdict';
import { CATEGORY_LABEL, type Category, type Change, type ComparisonResult, type SimilarityResult } from './model';

const APP_VERSION = '0.1.0';
const RED: [number, number, number] = [185, 28, 28];
const GREEN: [number, number, number] = [21, 128, 61];

// every character prints (Unicode fonts, pdfFonts.ts); only control and zero-width characters are taken out
// the fonts load on the first export: a tab left open across a deploy can fail to fetch them, and the button would otherwise do nothing
export const pdfFailed = (e: unknown) => window.alert(`The PDF could not be made (${e instanceof Error ? e.message : String(e)}). Reload the page and try again.`);
export const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F​-‍⁠﻿]/g, '');
const cut = (s: string | undefined, n = 300) => (s ? clean(s.length > n ? `${s.slice(0, n - 1)}...` : s) : '');

export interface ExportInput {
  result: ComparisonResult;
  layoutChanges: Change[];
  layout: { pages: LayoutPage[] };
  sim: SimilarityResult;
  override: boolean;
  settings: { similarityThreshold: number; layoutPixelRatio: number };
  fileNames: [string, string];
  all: Change[];
  visible: Change[];
  filtersNote: string;
  landscape: boolean;
  decisions?: Decisions;
  project?: ProjectReport;
  versions?: boolean; // intentionally different versions (addendum §0.2): titled Version comparison, no verdict, no watermark
}

/** A project round in the report (addendum §8): its summary, the timeline, and every replacement of the original. */
export interface ProjectReport {
  name: string;
  round: number;
  rounds: number;
  summary?: string;
  timeline: { number: number; addedAt: string; note?: string; words: number; summary: string; counts: string; verdict: Verdict; largestLoss: boolean }[];
  replacements: { round: number; at: string; reason: string; absorbed: number; items: string[] }[];
}

const VERDICT_COLOUR: Record<Verdict, [number, number, number]> = { red: RED, amber: [146, 64, 14], green: GREEN };
const DECISION_WORD = { restore: 'Restore', accept: 'Accepted', later: 'Fix later' } as const;
export const WATERMARK = 'UNRESOLVED ISSUES — NOT READY TO SUBMIT';

/** Builds the comparison report (returned, so it can be tested); exportPdf saves it. */
export async function buildReportPdf(x: ExportInput): Promise<jsPDF> {
  const doc = await newPdf(JSON.stringify(x, (k, v) => (k === 'thumb' ? undefined : v)));
  const margin = 40;
  let y = margin;
  const line = (text: string, size = 10, bold = false, colour: [number, number, number] = [30, 30, 30]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(...colour);
    for (const l of doc.splitTextToSize(clean(text), doc.internal.pageSize.getWidth() - margin * 2) as string[]) {
      if (y > doc.internal.pageSize.getHeight() - margin) { doc.addPage(); y = margin; }
      doc.text(l, margin, y); y += size * 1.35;
    }
    doc.setTextColor(30, 30, 30);
  };
  const after = () => ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18);

  // ---- page 1: the verdict (addendum §8) ----
  const items = reviewItems(x.all, x.decisions ?? {});
  const verdict = verdictOf(items);
  const W = doc.internal.pageSize.getWidth();
  if (x.versions) {
    line('Version comparison', 18, true);
    y += 4;
    line(`Version A: ${x.fileNames[0]}`);
    line(`Version B: ${x.fileNames[1]}`);
    line(`Compared: ${new Date().toLocaleString()} · DocCompare ${APP_VERSION}`);
    y += 8;
    line('These versions are meant to differ, so there is no verdict and nothing to decide. Numbers and quotes are still listed below: a statistic or a quote should not differ between versions.', 10);
    y += 4;
    line(ACCURACY_NOTE, 9, false, [90, 90, 90]);
    y += 8;
    const groups = x.result.sections ?? [];
    line('Sections', 12, true);
    autoTable(doc, {
      startY: y,
      head: [['Section', 'Status', 'Words in A', 'Words in B']],
      body: groups.map((g) => [cut(g.titleB ? `${g.title} / ${g.titleB}` : g.title, 120), `${SECTION_STATUS_LABEL[g.status]}${g.similarity !== undefined ? ` (${g.similarity}% alike)` : ''}`, String(g.wordsA), String(g.wordsB)]),
      styles: { fontSize: 8, cellPadding: 3, valign: 'top' },
      headStyles: { fillColor: [155, 91, 70] },
      margin: { left: margin, right: margin },
    });
    y = after();
    const still = stillCheck(x.all);
    line(still.length ? `Still check: ${still.length} number or quote change${still.length === 1 ? '' : 's'}` : 'No numbers or quotes differ between the versions.', 12, true);
    if (still.length) {
      autoTable(doc, {
        startY: y,
        head: [['What', 'Where', 'Version A', 'Version B']],
        body: still.map((c) => [cut(c.summary, 160), cut(c.location, 80), cut(c.original, 200), cut(c.edited, 200)]),
        styles: { fontSize: 8, cellPadding: 3, valign: 'top' },
        headStyles: { fillColor: [155, 91, 70] },
        margin: { left: margin, right: margin },
      });
      y = after();
    }
  } else {
  line('Submission check', 18, true);
  y += 4;
  if (x.project) line(`Project: ${x.project.name} · round ${x.project.round} of ${x.project.rounds}`, 11, true);
  line(`Original: ${x.fileNames[0]}`);
  line(`Edited: ${x.fileNames[1]}`);
  line(`Checked: ${new Date().toLocaleString()} · DocCompare ${APP_VERSION}`);
  y += 10;
  doc.setFillColor(...VERDICT_COLOUR[verdict]).roundedRect(margin, y, W - margin * 2, 46, 6, 6, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(255, 255, 255).text(clean(VERDICT_TEXT[verdict].title), margin + 16, y + 30);
  doc.setTextColor(30, 30, 30);
  y += 66;
  line(summarySentence(x.all), 11);
  if (x.project?.summary) line(x.project.summary, 11, true);
  y += 4;
  line(ACCURACY_NOTE, 9, false, [90, 90, 90]);
  y += 6;
  const p = progress(items);
  line(`Decisions: ${decisionsSummary(items)} (${p.decided} of ${p.total} decided).`, 10, true);
  const w = x.result.words;
  if (w) line(`Words: ${w.original.toLocaleString('en-AU')} in the original, ${w.edited.toLocaleString('en-AU')} in the edited version${w.limit ? `; limit ${w.limit.toLocaleString('en-AU')}${w.edited > w.limit ? ` (over by ${(w.edited - w.limit).toLocaleString('en-AU')})` : ' (within the limit)'}` : ''}${w.referencesExcluded ? '; reference list not counted' : ''}.`, 10);
  y += 8;
  if (items.length) {
    line('Items to decide', 12, true);
    autoTable(doc, {
      startY: y,
      head: [['', 'What happened', 'Where', 'Decision']],
      body: items.map((i) => [i.tier === 'red' ? 'Red' : 'Amber', cut(i.change.summary, 220), cut(i.change.location, 80), i.decision ? `${DECISION_WORD[i.decision.decision]}\n${new Date(i.decision.decidedAt).toLocaleString()}` : 'Not decided']),
      styles: { fontSize: 8, cellPadding: 3, valign: 'top' },
      headStyles: { fillColor: [155, 91, 70] },
      columnStyles: { 0: { cellWidth: 40 }, 2: { cellWidth: 110 }, 3: { cellWidth: 90 } },
      didParseCell: (d) => {
        if (d.section !== 'body') return;
        if (d.column.index === 0) { d.cell.styles.textColor = d.cell.raw === 'Red' ? RED : [146, 64, 14]; d.cell.styles.fontStyle = 'bold'; }
        if (d.column.index === 3 && (d.cell.raw === 'Not decided' || String(d.cell.raw).startsWith('Fix later'))) d.cell.styles.textColor = RED;
      },
      margin: { left: margin, right: margin },
    });
    y = after();
  }

  }

  // ---- a project: the timeline and every replacement of the original (never left out, §7.7) ----
  if (x.project) {
    y += 6;
    line('Timeline', 12, true);
    autoTable(doc, {
      startY: y,
      head: [['Round', 'Added', 'Note', 'Words', 'Fixed / not fixed / new', 'Red / amber / info', 'Verdict']],
      body: x.project.timeline.map((r) => [String(r.number), new Date(r.addedAt).toLocaleDateString('en-AU'), cut(r.note ?? '', 80), `${r.words}${r.largestLoss ? ' (most lost)' : ''}`, r.summary, r.counts, clean(VERDICT_TEXT[r.verdict].title)]),
      styles: { fontSize: 8, cellPadding: 3, valign: 'top' },
      headStyles: { fillColor: [155, 91, 70] },
      margin: { left: margin, right: margin },
    });
    y = after();
    if (x.project.replacements.length) {
      line('Original replaced', 12, true);
      for (const r of x.project.replacements) line(`Round ${r.round} became the new original on ${new Date(r.at).toLocaleString('en-AU')}. Reason: ${r.reason}. Open issues accepted with it: ${r.absorbed}${r.items.length ? ` (${r.items.join('; ')})` : ''}.`, 10);
    }
  }

  // ---- the existing report, as the full detail ----
  doc.addPage();
  y = margin;
  line('Full detail', 16, true);
  y += 4;
  line('Checks', 12, true);
  line('File type check: passed (same type)');
  line(`Same-document similarity: ${x.sim.score}/100 (threshold ${x.settings.similarityThreshold})${x.override ? ' - below threshold; "Compare anyway" was used' : ''}`);
  for (const r of x.sim.reasons) line(`  - ${r}`, 9);
  y += 6;

  const real = x.all.filter((c) => !c.trivial);
  const cats = (Object.keys(CATEGORY_LABEL) as Category[]).filter((c) => real.some((r) => r.category === c));
  autoTable(doc, {
    startY: y,
    head: [['Change type', 'High', 'Medium', 'Low', 'Total']],
    body: [
      ...cats.map((c) => { const r = real.filter((z) => z.category === c); return [CATEGORY_LABEL[c], ...(['high', 'medium', 'low'] as const).map((s) => String(r.filter((z) => z.severity === s).length)), String(r.length)]; }),
      ['Trivial (hidden)', '', '', '', String(x.result.trivialCount)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [155, 91, 70] },
    margin: { left: margin, right: margin },
  });
  y = after();

  autoTable(doc, {
    startY: y,
    head: [['Metadata', 'Original', 'Edited', 'Difference']],
    body: x.result.metadata.map((m) => [`${m.flagged ? '! ' : ''}${m.label}`, clean(m.original), clean(m.edited), clean(m.difference)]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [155, 91, 70] },
    margin: { left: margin, right: margin },
  });

  // changes table on its own page(s), landscape if asked
  doc.addPage('a4', x.landscape ? 'landscape' : 'portrait');
  y = margin;
  line('Changes', 12, true);
  line(x.filtersNote ? `Filters applied: ${x.filtersNote} (${x.visible.length} of ${x.all.filter((c) => !c.trivial).length} changes)` : `All ${x.visible.length} changes (no filters).`, 9);
  autoTable(doc, {
    startY: y + 4,
    head: [['#', 'Location', 'Change type', 'Original', 'Edited', 'Severity']],
    body: x.visible.map((c) => [String(c.id), cut(c.location, 120), `${CATEGORY_LABEL[c.category]}${c.trivial ? ' (trivial)' : ''}${c.detail ? `\n${cut(c.detail, 200)}` : ''}${c.children ? `\n(${c.children.length} items)` : ''}`, cut(c.original), cut(c.edited), c.severity]),
    styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [155, 91, 70] },
    columnStyles: x.landscape ? { 0: { cellWidth: 26 }, 1: { cellWidth: 110 }, 2: { cellWidth: 120 }, 5: { cellWidth: 50 } } : { 0: { cellWidth: 22 }, 1: { cellWidth: 80 }, 2: { cellWidth: 80 }, 5: { cellWidth: 44 } },
    didParseCell: (d) => {
      if (d.section !== 'body') return;
      if (d.column.index === 3) d.cell.styles.textColor = RED;
      if (d.column.index === 4) d.cell.styles.textColor = GREEN;
      if (d.column.index === 5 && d.cell.raw === 'high') d.cell.styles.fontStyle = 'bold';
    },
    margin: { left: margin, right: margin },
  });

  const changedPages = x.layout.pages.filter((p) => p.thumb);
  if (changedPages.length) {
    doc.addPage('a4', 'portrait');
    y = margin;
    line('Layout changes (PDF pages, changed pixels in red)', 12, true);
    const w = 160, gap = 16;
    let col = 0;
    for (const p of changedPages) {
      const props = doc.getImageProperties(p.thumb!);
      const h = (props.height / props.width) * w;
      if (y + h + 20 > doc.internal.pageSize.getHeight() - margin) { doc.addPage('a4', 'portrait'); y = margin; col = 0; }
      const xPos = margin + col * (w + gap);
      doc.setFontSize(9).text(`Page ${p.a ?? '-'} vs ${p.b ?? '-'} · ${(p.ratio * 100).toFixed(1)}%`, xPos, y + 9);
      doc.addImage(p.thumb!, 'JPEG', xPos, y + 14, w, h);
      col++;
      if (col === 3) { col = 0; y += h + 34; }
    }
  }

  // any red item open or marked Fix later: every page carries the watermark (cannot be turned off; addendum §8)
  if (verdict === 'red' && !x.versions) {
    const n = doc.getNumberOfPages();
    for (let pg = 1; pg <= n; pg++) {
      doc.setPage(pg);
      const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
      doc.saveGraphicsState();
      doc.setGState(new (doc as unknown as { GState: new (o: { opacity: number }) => unknown }).GState({ opacity: 0.13 }) as never);
      doc.setFont('helvetica', 'bold').setFontSize(pw > ph ? 34 : 26).setTextColor(...RED);
      doc.text(clean(WATERMARK), pw / 2, ph / 2, { align: 'center', angle: 35, baseline: 'middle' } as never);
      doc.restoreGraphicsState();
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...RED).text(clean(WATERMARK), pw / 2, ph - 16, { align: 'center' });
    }
    doc.setTextColor(30, 30, 30);
  }
  return doc;
}

export async function exportPdf(x: ExportInput): Promise<void> {
  const base = x.fileNames[0].replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await buildReportPdf(x).then((doc) => doc.save(`${x.versions ? 'version_comparison' : 'comparison'}_${base}_${date}.pdf`), pdfFailed);
}
