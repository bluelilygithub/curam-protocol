import { Document, ExternalHyperlink, HeadingLevel, ImageRun, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType, type ParagraphChild } from 'docx';
import type { Block, NormalizedDoc, Run } from '../readers/types';

/**
 * "Download as Word": a project's original (usually a web page) as a .docx made in the browser, for editing in Word or Google Docs.
 * It keeps headings, paragraphs, lists (restarting where the page's lists restart), tables, links, bold / italic / underline /
 * strikethrough, block quotes and code. Every run's formatting is written explicitly, so Word's styles do not add any, and the file reads
 * back through the DOCX reader as the same blocks (tests/webPages.test.ts). Pictures are not downloaded (nothing is fetched): each is a
 * small grey placeholder carrying the page's alt text, so it stays an image and is not reported as removed.
 */

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
// an 8 x 8 light grey PNG
const PLACEHOLDER = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4/fs3VsQwMiQA4G7Rgdc3W1oAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));

function textRuns(r: Run): TextRun[] {
  // line breaks inside a paragraph (<br>) become Word line breaks
  return r.text.split('\n').map((part, i) => new TextRun({
    text: part,
    break: i > 0 ? 1 : undefined,
    bold: !!r.bold,
    italics: !!r.italic,
    underline: r.underline ? {} : undefined,
    strike: !!r.strike,
    style: r.link ? 'Hyperlink' : undefined,
  }));
}

function children(runs: Run[]): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const r of runs) {
    if (r.link && /^(https?|mailto|tel):/i.test(r.link)) out.push(new ExternalHyperlink({ link: r.link, children: textRuns(r) }));
    else out.push(...textRuns(r));
  }
  return out;
}

const image = (alt: string) => new ImageRun({ type: 'png', data: PLACEHOLDER, transformation: { width: 96, height: 54 }, altText: { name: 'Picture', description: alt, title: alt } });

export async function buildWordDoc(doc: NormalizedDoc): Promise<Blob> {
  const body: (Paragraph | Table)[] = [];
  let listInstance = 0;
  let inList = false;
  const blocks = doc.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type !== 'listItem') inList = false;
    switch (b.type) {
      case 'heading':
        body.push(new Paragraph({ heading: HEADINGS[Math.min(6, Math.max(1, b.level ?? 1)) - 1], children: children(b.runs) }));
        break;
      case 'listItem': {
        if (!inList) { listInstance++; inList = true; }
        const ordered = /ordered|number/i.test(b.style ?? '') || !!b.number;
        body.push(new Paragraph({ numbering: { reference: ordered ? 'numbered' : 'bullets', level: Math.min(8, (b.level ?? 1) - 1), instance: listInstance }, children: children(b.runs) }));
        break;
      }
      case 'image':
        body.push(new Paragraph({ children: [image(b.text)] }));
        break;
      case 'tableCell': {
        // every cell of this table, with the pictures that follow a cell kept in that cell
        const t = b.location.table!.t;
        const cells: { block: Block; images: string[] }[] = [];
        for (; i < blocks.length; i++) {
          const x = blocks[i];
          if (x.type === 'tableCell' && x.location.table?.t === t) cells.push({ block: x, images: [] });
          else if (x.type === 'image') cells[cells.length - 1].images.push(x.text); // both readers put a cell's pictures right after it
          else break;
        }
        i--;
        const rows = new Map<number, typeof cells>();
        for (const c of cells) { const r = c.block.location.table!.r; rows.set(r, [...(rows.get(r) ?? []), c]); }
        const width = Math.max(...[...rows.values()].map((r) => r.length));
        body.push(new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [...rows.values()].map((r) => new TableRow({
            // a short row (colspan on the page) gets a wider last cell, not empty cells that would read back as extra cells
            children: r.map((cell, c) => new TableCell({
              columnSpan: c === r.length - 1 && r.length < width ? width - r.length + 1 : undefined,
              // a cell's lines were separate paragraphs in Word; the reader joins them with line breaks
              children: [...splitLines(cell.block.runs).map((l) => new Paragraph({ children: children(l) })), ...cell.images.map((alt) => new Paragraph({ children: [image(alt)] }))],
            })),
          })),
        }));
        break;
      }
      case 'pageBreak':
        break;
      default:
        body.push(new Paragraph({ style: b.style && /^(Quote|Code)$/.test(b.style) ? b.style : undefined, children: children(b.runs) }));
    }
  }

  const levels = (format: (typeof LevelFormat)[keyof typeof LevelFormat], text: (l: number) => string) =>
    Array.from({ length: 9 }, (_, l) => ({ level: l, format, text: text(l), style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } } }));
  const word = new Document({
    title: doc.metadata.title,
    creator: doc.metadata.author ?? '',
    description: `Exported by DocCompare${doc.metadata.url ? ` from ${doc.metadata.url}` : ''} on ${new Date().toLocaleString('en-AU')}`,
    styles: {
      paragraphStyles: [
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', paragraph: { indent: { left: 720, right: 720 } } },
        { id: 'Code', name: 'Code', basedOn: 'Normal', run: { font: 'Courier New' } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: levels(LevelFormat.BULLET, (l) => ['•', '◦', '▪'][l % 3]) },
        { reference: 'numbered', levels: levels(LevelFormat.DECIMAL, (l) => `%${l + 1}.`) },
      ],
    },
    sections: [{ children: body }],
  });
  return Packer.toBlob(word);
}

function splitLines(runs: Run[]): Run[][] {
  const lines: Run[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((p, i) => { if (i > 0) lines.push([]); if (p) lines[lines.length - 1].push({ ...r, text: p }); });
  }
  return lines;
}

/** Saves the original as `<name>.docx`. */
export async function downloadWord(doc: NormalizedDoc, name: string): Promise<void> {
  const blob = await buildWordDoc(doc);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'original'}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
