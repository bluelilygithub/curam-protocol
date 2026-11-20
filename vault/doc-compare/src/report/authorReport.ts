import { jsPDF } from 'jspdf';
import { CATEGORY_LABEL, type Change, type Severity } from './model';
import { latin1 } from './pdfExport';

/**
 * "Review for the author": a complete, actionable PDF to send back to whoever produced the edit. Unlike the comparison report it ignores the
 * table filters (every real change is in it; trivial whitespace/quote differences are only counted), and each item says what to do, with a
 * tick box, so the author can work through it.
 */

const quote = (s: string | undefined, n = 80) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `"${t.slice(0, n - 1)}…"` : `"${t}"`;
};

/** The one instruction for a change, in plain words. */
export function actionFor(c: Change): string {
  switch (c.category) {
    case 'removed':
      if (c.group === 'section') return `Restore the missing section ${quote(c.original, 60)} and everything under it (${c.children?.length ?? 0} items, listed below).`;
      if (c.group === 'tableRow') return 'Restore the missing table row shown below.';
      if (c.detail === 'Image removed') return 'Restore the missing image.';
      if (c.detail === 'Heading removed') return `Restore the missing heading ${quote(c.original, 60)}.`;
      return 'Restore this text: it is in the original but missing from the edited version.';
    case 'added':
      if (c.group === 'section') return `Confirm the new section ${quote(c.edited, 60)} is wanted; remove it if not.`;
      if (c.detail === 'Image added') return 'Confirm the added image is wanted; remove it if not.';
      return 'Confirm this added text is wanted; remove it if not.';
    case 'moved':
      return `Confirm this text should move (${c.location}); otherwise put it back where it was.`;
    case 'number':
      return `Check the changed figure${/;/.test(c.detail ?? '') ? 's' : ''}: ${c.detail ?? ''}. Restore the original value unless the change was intended.`;
    case 'wording':
      if (c.trivial) return 'No action: only spacing, quotes or invisible characters differ.';
      if (c.severity === 'high') return 'Restore the words dropped from this paragraph (struck through below), or confirm they should go.';
      return 'Review the rewording: keep it, or restore the original wording.';
    case 'typo':
      return `Check the spelling change ${c.detail ?? ''}: keep it if it fixes a mistake, otherwise restore the original.`;
    case 'formatting':
      return `Restore the original formatting unless the change was intended: ${c.detail ?? 'formatting changed'}.`;
    case 'layout':
      return `Check ${c.location.replace(/ \(edited\)$/, '')} of the edited PDF: ${c.detail ?? 'its layout changed'}.`;
    case 'metadata':
      return `Check: ${c.detail ?? 'a file detail changed'}.`;
    default:
      return 'Review this change.';
  }
}

/** The items the author gets: every non-trivial change, plus only the metadata flags worth acting on. Most serious first, then document order. */
export function authorItems(changes: Change[]): Change[] {
  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  return changes
    .filter((c) => !c.trivial && (c.category !== 'metadata' || c.severity !== 'low'))
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.id - b.id);
}

export interface AuthorInput {
  changes: Change[]; // the comparison's changes plus layout changes
  trivialCount: number;
  fileNames: [string, string];
  similarity: number;
  override: boolean;
}

const SECTIONS: { sev: Severity; title: string; intro: string; colour: [number, number, number] }[] = [
  { sev: 'high', title: 'Must fix', intro: 'Content that is missing, or figures and dates that changed. These need fixing or a clear reason to keep them.', colour: [185, 28, 28] },
  { sev: 'medium', title: 'Please review', intro: 'Added, reworded or moved content and structure changes. Keep each one only if it was intended.', colour: [146, 64, 14] },
  { sev: 'low', title: 'Minor', intro: 'Spelling fixes and small formatting changes. Usually fine; check quickly.', colour: [90, 90, 90] },
];

/** Builds the PDF (returned, not saved, so it can be tested). */
export function buildAuthorPdf(x: AuthorInput): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 48, width = W - M * 2, bottom = H - 50;
  let y = M;
  const items = authorItems(x.changes);

  const font = (size: number, style: 'normal' | 'bold' | 'italic' = 'normal', colour: [number, number, number] = [30, 30, 30]) => doc.setFont('helvetica', style).setFontSize(size).setTextColor(...colour);
  const lines = (text: string, w = width) => doc.splitTextToSize(latin1(text), w) as string[];
  const need = (h: number) => { if (y + h > bottom) { doc.addPage(); y = M; } };
  const para = (text: string, size = 10, style: 'normal' | 'bold' | 'italic' = 'normal', colour?: [number, number, number], indent = 0) => {
    font(size, style, colour);
    for (const l of lines(text, width - indent)) { need(size * 1.4); doc.text(l, M + indent, y); y += size * 1.4; }
  };

  // ---- cover ----
  font(20, 'bold'); doc.text('Review of the edited document', M, y); y += 26;
  para('Changes to check before this version is used', 12, 'normal', [90, 90, 90]); y += 6;
  para(`Original: ${x.fileNames[0]}`, 10); para(`Edited version: ${x.fileNames[1]}`, 10);
  para(`Prepared: ${new Date().toLocaleString()} with DocCompare`, 10, 'normal', [90, 90, 90]);
  if (x.override) para(`Note: the two files were only ${x.similarity}% alike, so they may not be versions of the same document.`, 10, 'italic', [146, 64, 14]);
  y += 10;

  const counts = SECTIONS.map((s) => items.filter((c) => c.severity === s.sev).length);
  doc.setDrawColor(220, 210, 200).setFillColor(247, 243, 238).roundedRect(M, y, width, 74, 6, 6, 'FD');
  const colW = width / 3;
  SECTIONS.forEach((s, i) => {
    font(22, 'bold', s.colour); doc.text(String(counts[i]), M + colW * i + 16, y + 34);
    font(10, 'normal', [60, 60, 60]); doc.text(s.title, M + colW * i + 16, y + 54);
  });
  y += 92;
  para(items.length ? `${items.length} item${items.length === 1 ? '' : 's'} to work through.` : 'No changes need action: the edited version matches the original.', 11, 'bold');
  if (x.trivialCount) para(`${x.trivialCount} difference${x.trivialCount === 1 ? '' : 's'} in spacing, quotes or invisible characters were ignored and are not listed.`, 9, 'normal', [90, 90, 90]);
  y += 6;
  para('How to use this list', 11, 'bold');
  para('Each item says where it is, what to do, and shows the original and edited text. Text in red was removed; text in green was added. Tick the box when the item is done, or note why the change should stay.', 10);
  y += 8;

  // ---- items ----
  let n = 0;
  for (const [i, s] of SECTIONS.entries()) {
    const list = items.filter((c) => c.severity === s.sev);
    if (!list.length) continue;
    need(70);
    y += 6;
    doc.setDrawColor(...s.colour).setLineWidth(1.2).line(M, y, M + width, y); y += 18;
    font(14, 'bold', s.colour); doc.text(`${s.title} (${counts[i]})`, M, y); y += 16;
    para(s.intro, 9, 'italic', [90, 90, 90]); y += 6;

    for (const c of list) {
      n++;
      need(64);
      // tick box and heading line
      doc.setDrawColor(120, 120, 120).setLineWidth(0.8).rect(M, y - 9, 10, 10);
      font(10, 'bold'); doc.text(latin1(`${n}.  ${CATEGORY_LABEL[c.category]}`), M + 18, y);
      font(9, 'normal', [90, 90, 90]); doc.text(latin1(c.location).slice(0, 110), M + 18 + doc.getTextWidth(latin1(`${n}.  ${CATEGORY_LABEL[c.category]}`)) + 14, y);
      y += 15;
      para(actionFor(c), 10, 'bold', [30, 30, 30], 18);
      const colour: [number, number, number] = c.category === 'added' ? [21, 128, 61] : [185, 28, 28];
      if (c.category === 'metadata') {
        para(`Original: ${c.original ?? '-'}     Edited: ${c.edited ?? '-'}`, 9, 'normal', [70, 70, 70], 18);
      } else if (c.group === 'section' && c.children?.length) {
        // the heading is the first child: list the section's contents once
        para(c.category === 'added' ? 'Added section:' : 'Missing section:', 9, 'bold', colour, 18);
        for (const k of c.children.slice(0, 40)) para(`- ${k.location}: ${(k.original ?? k.edited ?? k.detail ?? '').slice(0, 400)}`, 9, 'normal', colour, 26);
        if (c.children.length > 40) para(`…and ${c.children.length - 40} more.`, 9, 'italic', [90, 90, 90], 26);
      } else if (c.diffHtml && c.category !== 'formatting') {
        diffBlock(c.diffHtml);
      } else if (c.original !== undefined && c.original === c.edited) {
        block('Text', c.original, [70, 70, 70]); // moved or reformatted: the words are the same
      } else {
        if (c.original) block(c.group === 'tableRow' ? 'Missing row' : 'Original', c.original, [185, 28, 28]);
        if (c.edited) block(c.group === 'tableRow' ? 'Added row' : 'Edited', c.edited, [21, 128, 61]);
      }
      y += 10;
    }
  }

  // ---- footers ----
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    font(8, 'normal', [130, 130, 130]);
    doc.text(latin1(`Review of ${x.fileNames[1]}`).slice(0, 90), M, H - 28);
    doc.text(`Page ${p} of ${total}`, W - M, H - 28, { align: 'right' });
  }
  return doc;

  // labelled text, long text shortened
  function block(label: string, text: string, colour: [number, number, number]) {
    const t = text.length > 1500 ? `${text.slice(0, 1499)}… (shortened)` : text;
    para(`${label}:`, 9, 'bold', colour, 18);
    para(t, 9, 'normal', colour, 18);
  }

  // the word diff: removed words in red and struck through, added in green, the rest grey; wrapped word by word
  function diffBlock(html: string) {
    const parts = [...html.matchAll(/<(del|ins)>([\s\S]*?)<\/\1>|([^<]+)/g)].map((m) => ({ kind: m[1] ?? 'same', text: unescape(m[2] ?? m[3] ?? '') }));
    const size = 9, lh = size * 1.45, left = M + 18, right = M + width;
    let x0 = left;
    font(size);
    need(lh);
    let count = 0;
    for (const p of parts) {
      for (const word of latin1(p.text).split(/(\s+)/)) {
        if (!word) continue;
        if (count++ > 2500) return; // very long paragraphs: the start is enough to find it
        const ws = /^\s+$/.test(word);
        const w = doc.getTextWidth(ws ? ' ' : word);
        if (!ws && x0 + w > right) { y += lh; need(lh); x0 = left; }
        if (ws) { if (x0 > left) x0 += doc.getTextWidth(' '); continue; }
        const colour: [number, number, number] = p.kind === 'del' ? [185, 28, 28] : p.kind === 'ins' ? [21, 128, 61] : [70, 70, 70];
        doc.setTextColor(...colour).text(word, x0, y);
        if (p.kind === 'del') doc.setDrawColor(...colour).setLineWidth(0.6).line(x0, y - size * 0.3, x0 + w, y - size * 0.3);
        if (p.kind === 'ins') doc.setDrawColor(...colour).setLineWidth(0.6).line(x0, y + 1.5, x0 + w, y + 1.5);
        x0 += w;
      }
    }
    y += lh + 2;
  }
}

const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

export function downloadAuthorPdf(x: AuthorInput): void {
  const base = x.fileNames[1].replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_');
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  buildAuthorPdf(x).save(`review_${base}_${date}.pdf`);
}
