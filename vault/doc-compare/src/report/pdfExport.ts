import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { mapQuotes } from '../compare/normalize';
import type { LayoutPage } from '../compare/layout';
import { CATEGORY_LABEL, type Category, type Change, type ComparisonResult, type SimilarityResult } from './model';

const APP_VERSION = '0.1.0';
const RED: [number, number, number] = [185, 28, 28];
const GREEN: [number, number, number] = [21, 128, 61];

// shortcut: jsPDF's built-in fonts are Latin-1 only, so other characters print as "?"; embed a TTF font if reports need other scripts
const latin1 = (s: string) => mapQuotes(s).replace(/[…]/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
const cut = (s: string | undefined, n = 300) => (s ? latin1(s.length > n ? `${s.slice(0, n - 1)}...` : s) : '');

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
}

export function exportPdf(x: ExportInput): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const margin = 40;
  let y = margin;
  const line = (text: string, size = 10, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size);
    for (const l of doc.splitTextToSize(latin1(text), doc.internal.pageSize.getWidth() - margin * 2) as string[]) { doc.text(l, margin, y); y += size * 1.35; }
  };
  const after = () => ((doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18);

  line('DocCompare report', 18, true);
  y += 4;
  line(`Original: ${x.fileNames[0]}`);
  line(`Edited: ${x.fileNames[1]}`);
  line(`Compared: ${new Date().toLocaleString()} · DocCompare ${APP_VERSION}`);
  y += 6;
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
    body: x.result.metadata.map((m) => [`${m.flagged ? '! ' : ''}${m.label}`, latin1(m.original), latin1(m.edited), latin1(m.difference)]),
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

  const base = x.fileNames[0].replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  doc.save(`comparison_${base}_${date}.pdf`);
}
