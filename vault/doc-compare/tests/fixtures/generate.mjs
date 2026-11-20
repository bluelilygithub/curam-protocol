// Builds test document pairs in memory (DOCX via `docx`, PDF via `pdf-lib`, plus .md/.txt), each with its expected
// changes. Used by the tests directly and written to disk by `npm run fixtures` (scripts/fixtures.mjs) for manual UI testing.
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** @typedef {{ h: number, text: string } | { p: string, bold?: string, font?: string } | { table: string[][] }} Item */

/** @type {Item[]} */
const BASE = [
  { h: 1, text: 'Service Agreement' },
  { p: 'This agreement is made between Acme Pty Ltd and the Client named in the order form, and sets out the terms on which the services are supplied.' },
  { h: 2, text: '1. Scope' },
  { p: 'Acme will design, build and launch a marketing website for the Client, including up to twelve page templates and a content management system.' },
  { p: 'Hosting, domain registration and third-party licences are outside the scope of this agreement unless they are listed in a separate schedule.' },
  { p: 'The Client will provide all copy, images and brand assets in an agreed format, and we will receive feedback within five business days of each review.' },
  { h: 2, text: '2. Payment Terms' },
  { p: 'Invoices are payable within 30 days of issue. Late payments attract interest at the rate set out in the order form.', bold: 'payable within 30 days' },
  { p: 'A deposit of forty percent is due on signing, with the balance split evenly across the design and build milestones.' },
  { h: 2, text: '3. Deliverables' },
  { table: [['Item', 'Due', 'Owner'], ['Design', 'March', 'Acme design team'], ['Build', 'June', 'Acme engineering'], ['Launch', 'August', 'Client marketing']] },
  { h: 2, text: '4. Termination' },
  { p: 'Either party may end this agreement with written notice if the other party breaches a material term and does not fix the breach promptly.' },
  { p: 'On termination the Client pays for all work completed up to the date of notice, and Acme hands over every file produced so far.' },
  { h: 2, text: '5. Confidentiality' },
  { p: "Each party keeps the other's confidential information private and uses it only to perform this agreement, during its term and for three years after." },
];

const UNRELATED = [
  { h: 1, text: 'Sourdough Bread Recipe' },
  { p: 'Mix the flour and water and leave the dough to rest for one hour before adding the starter and salt.' },
  { h: 2, text: 'Shaping' },
  { p: 'Fold the dough every thirty minutes for two hours, then shape it into a tight round and place it in a floured basket.' },
  { h: 2, text: 'Baking' },
  { p: 'Bake in a covered pot at a high temperature for twenty minutes, then uncover and bake until the crust is deep brown.' },
];

const clone = (m) => structuredClone(m);
const idx = (m, pred) => m.findIndex(pred);
const paraWith = (m, s) => idx(m, (x) => 'p' in x && x.p.includes(s));

/** Each case: name, mutation of BASE, formats, and expected change categories (metadata and trivial excluded). */
const CASES = [
  { name: 'identical', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => m, expect: [] },
  { name: 'paragraph-removed', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => { m.splice(paraWith(m, 'Hosting, domain'), 1); return m; }, expect: ['removed'] },
  { name: 'section-removed', formats: ['docx', 'pdf', 'md'], edit: (m) => { const i = idx(m, (x) => x.text === '4. Termination'); m.splice(i, 3); return m; }, expect: ['removed'] },
  { name: 'typo-introduced', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => { const i = paraWith(m, 'we will receive'); m[i].p = m[i].p.replace('receive', 'recieve'); return m; }, expect: ['typo'] },
  { name: 'typo-corrected', formats: ['docx', 'md', 'txt'], original: (m) => { const i = paraWith(m, 'we will receive'); m[i].p = m[i].p.replace('receive', 'recieve'); return m; }, edit: (m) => { const i = paraWith(m, 'we will recieve'); m[i].p = m[i].p.replace('recieve', 'receive'); return m; }, expect: ['typo'] },
  { name: 'number-changed', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => { const i = paraWith(m, '30 days'); m[i].p = m[i].p.replace('30 days', '60 days'); m[i].bold = 'payable within 60 days'; return m; }, expect: ['number'] },
  { name: 'heading-level', formats: ['docx', 'pdf', 'md'], edit: (m) => { m[idx(m, (x) => x.text === '3. Deliverables')].h = 3; return m; }, expect: ['formatting'] },
  { name: 'bold-removed', formats: ['docx', 'pdf', 'md'], edit: (m) => { delete m[paraWith(m, '30 days')].bold; return m; }, expect: ['formatting'] },
  { name: 'font-changed', formats: ['docx', 'pdf'], edit: (m) => { m[paraWith(m, 'A deposit')].font = 'Times New Roman'; return m; }, expect: ['formatting'] },
  { name: 'paragraph-moved', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => { const [p] = m.splice(paraWith(m, 'Hosting, domain'), 1); m.splice(paraWith(m, 'On termination') + 1, 0, p); return m; }, expect: ['moved'] },
  { name: 'table-row-removed', formats: ['docx', 'md'], edit: (m) => { m[idx(m, (x) => 'table' in x)].table.splice(2, 1); return m; }, expect: ['removed'] },
  { name: 'whitespace-quotes', formats: ['docx', 'md', 'txt'], trivial: true, edit: (m) => m.map((x) => ('p' in x ? { ...x, p: x.p.replace(/'/g, '’').replace(/, /g, ',  ').replace('each review', 'each review') + '  ' } : x)), expect: [] },
];

// ---------- writers ----------

function toTxt(m) {
  return m.map((x) => ('h' in x ? x.text : 'p' in x ? x.p : x.table.map((r) => r.join(' | ')).join('\n'))).join('\n\n') + '\n';
}

function toMd(m) {
  return m.map((x) => {
    if ('h' in x) return `${'#'.repeat(x.h)} ${x.text}`;
    if ('p' in x) return x.bold ? x.p.replace(x.bold, `**${x.bold}**`) : x.p;
    const [head, ...rows] = x.table;
    return [`| ${head.join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  }).join('\n\n') + '\n';
}

const segments = (x) => {
  if (!x.bold || !x.p.includes(x.bold)) return [{ text: x.p }];
  const i = x.p.indexOf(x.bold);
  return [{ text: x.p.slice(0, i) }, { text: x.bold, bold: true }, { text: x.p.slice(i + x.bold.length) }].filter((s) => s.text);
};

async function toDocx(m) {
  const HL = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  const children = m.map((x) => {
    if ('h' in x) return new Paragraph({ heading: HL[x.h], children: [new TextRun(x.text)] });
    if ('p' in x) return new Paragraph({ children: segments(x).map((s) => new TextRun({ text: s.text, bold: s.bold, font: x.font })) });
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: x.table.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph(c)] })) })) });
  });
  const doc = new Document({ creator: 'DocCompare fixtures', title: 'Fixture', sections: [{ children }] });
  return new Uint8Array(await Packer.toBuffer(doc));
}

async function toPdf(m) {
  const pdf = await PDFDocument.create();
  pdf.setCreationDate(new Date('2026-01-01T00:00:00Z'));
  pdf.setModificationDate(new Date('2026-01-01T00:00:00Z'));
  pdf.setTitle('Fixture');
  const F = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold), times: await pdf.embedFont(StandardFonts.TimesRoman) };
  const left = 56, width = 483, bottom = 56;
  let page = pdf.addPage([595, 842]);
  let y = 790;
  const ensure = (h) => { if (y - h < bottom) { page = pdf.addPage([595, 842]); y = 790; } };
  for (const x of m) {
    if ('h' in x) {
      const size = { 1: 20, 2: 15, 3: 13 }[x.h];
      ensure(size * 3);
      y -= size * 1.6;
      page.drawText(x.text, { x: left, y, size, font: F.bold });
      y -= size * 0.6;
    } else if ('p' in x) {
      const size = 11;
      // greedy wrap over words, each word keeping its segment's font
      const wordsList = segments(x).flatMap((s) => s.text.split(/(?<= )/).filter(Boolean).map((w) => ({ w, font: x.font ? F.times : s.bold ? F.bold : F.regular })));
      const lines = [[]];
      let lw = 0;
      for (const t of wordsList) {
        const tw = t.font.widthOfTextAtSize(t.w, size);
        if (lw + tw > width && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
        lines[lines.length - 1].push(t); lw += tw;
      }
      for (const line of lines) {
        ensure(size * 1.35);
        y -= size * 1.35;
        let cx = left;
        // consecutive words with the same font go out as one text item
        for (let i = 0; i < line.length;) {
          let j = i, text = '';
          while (j < line.length && line[j].font === line[i].font) text += line[j++].w;
          const drawn = j === line.length ? text.trimEnd() : text;
          page.drawText(drawn, { x: cx, y, size, font: line[i].font });
          cx += line[i].font.widthOfTextAtSize(text, size);
          i = j;
        }
      }
      y -= size * 1.2;
    } else {
      for (const row of x.table) {
        ensure(24);
        y -= 24;
        row.forEach((c, i) => page.drawText(c, { x: left + i * 160, y, size: 11, font: F.regular }));
      }
      y -= 12;
    }
  }
  return new Uint8Array(await pdf.save({ useObjectStreams: false }));
}

const WRITERS = { txt: async (m) => new TextEncoder().encode(toTxt(m)), md: async (m) => new TextEncoder().encode(toMd(m)), docx: toDocx, pdf: toPdf };

/**
 * @returns {Promise<{ name: string, type: string, original: { name: string, bytes: Uint8Array }, edited: { name: string, bytes: Uint8Array },
 *   expect: { categories: string[], trivial?: boolean, gate?: 'type-mismatch' | 'similarity' } }[]>}
 */
export async function buildFixtures() {
  const out = [];
  for (const c of CASES) {
    for (const type of c.formats) {
      const orig = (c.original ?? ((m) => m))(clone(BASE));
      const edited = c.edit(clone(orig));
      out.push({ name: `${c.name}.${type}`, type, original: { name: `original.${type}`, bytes: await WRITERS[type](orig) }, edited: { name: `edited.${type}`, bytes: await WRITERS[type](edited) }, expect: { categories: c.expect, trivial: !!c.trivial } });
    }
  }
  for (const type of ['md', 'docx']) {
    out.push({ name: `unrelated.${type}`, type, original: { name: `original.${type}`, bytes: await WRITERS[type](clone(BASE)) }, edited: { name: `edited.${type}`, bytes: await WRITERS[type](clone(UNRELATED)) }, expect: { categories: [], gate: 'similarity' } });
  }
  out.push({ name: 'mismatched-types', type: 'mixed', original: { name: 'original.docx', bytes: await toDocx(BASE) }, edited: { name: 'edited.pdf', bytes: await toPdf(BASE) }, expect: { categories: [], gate: 'type-mismatch' } });
  return out;
}
