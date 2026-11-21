// Builds test document pairs in memory (DOCX via `docx`, PDF via `pdf-lib`, plus .md/.txt), each with its expected
// changes. Used by the tests directly and written to disk by `npm run fixtures` (scripts/fixtures.mjs) for manual UI testing.
import { AlignmentType, Document, FootnoteReferenceRun, HeadingLevel, LevelFormat, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx';
import { PDFDocument, StandardFonts } from 'pdf-lib';

/** @typedef {{ h: number, text: string } | { p: string, bold?: string, font?: string, fn?: string } | { li: string } | { table: string[][] }} Item */

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

/** A white-paper style submission (addendum §0.1 use cases): statistics, a direct quote, a table, numbered recommendations, references. */
const WP = [
  { h: 1, text: 'Submission to the Inquiry into Housing Affordability' },
  { p: 'This submission from the Tenants Advice Network responds to the terms of reference and draws on our casework with 1,200 households across New South Wales during 2023.' },
  { h: 2, text: '1. Background' },
  { p: 'Rents in Sydney rose by 14% in the twelve months to June 2023, the fastest rise in more than a decade, while the median household income rose by 3.2%.' },
  { p: 'These figures cover the private rental market only and do not include social housing, where waiting times are measured in a different way and published separately.' },
  { p: 'Around 42% of the households we assisted were paying more than half of their income in rent, which is well above the usual measure of housing stress.' },
  { h: 2, text: '2. Evidence' },
  { p: 'One tenant told us, "We moved three times in two years because every lease ended with a rent increase we could not meet."' },
  { p: 'Our caseworkers recorded 318 notices to vacate in 2023, compared with 201 in 2021, and most were issued without any reason given.' },
  { table: [['Year', 'Notices to vacate', 'Households assisted'], ['2021', '201', '860'], ['2022', '264', '1,010'], ['2023', '318', '1,200']] },
  { h: 2, text: '3. Recommendations' },
  { p: '1. End no-grounds evictions for all residential leases in New South Wales, with a fair process for landlords who need to sell or move in.' },
  { p: '2. Limit rent increases to once every twelve months and require a clear written reason for any increase.' },
  { p: '3. Fund tenant advocacy services to meet demand, which has grown by 40% since 2021.' },
  { h: 2, text: '4. Impact on families' },
  { p: 'Families who are forced to move often lose contact with schools, doctors and support networks, and children suffer when they change schools during the year.' },
  { p: 'Older renters face particular difficulty, because they are less likely to find new housing close to the family and community services they depend on.' },
  { h: 2, text: 'References' },
  { p: '[1] Australian Housing and Urban Research Institute (2022), Forced moves and housing insecurity, Final Report 378.' },
  { p: '[2] NSW Department of Communities and Justice (2023), Rent and Sales Report, Issue 145.' },
];

/** The white paper with a version line under the title (addendum §7.10). */
const VWP = [WP[0], { p: 'Version 1.2, November 2023. Prepared by the policy team.' }, ...WP.slice(1)];

/** The white paper with numbered citations in the text (addendum §5.1). */
const WPC = WP.map((x) => ('p' in x && x.p.startsWith('Rents in Sydney') ? { ...x, p: x.p.replace('rose by 3.2%.', 'rose by 3.2% [2].') } : 'p' in x && x.p.startsWith('Families who') ? { ...x, p: x.p.replace('during the year.', 'during the year [1].') } : x));
/** The white paper with a footnote on the caveat paragraph. */
const WPF = WP.map((x) => ('p' in x && x.p.startsWith('These figures cover') ? { ...x, fn: 'Private rental data from the NSW Rental Bond Board, June 2023.' } : x));
/** Australian spelling and a defined term, for the spelling and terminology checks (§5.5). */
const WPS = [...WP.slice(0, 7), { p: 'Our organisation analysed the behaviour of landlords and prioritised the centre of each neighbourhood, recognising that colour and favour play no part.' }, { p: 'The Residential Tenancies Act 2010 (the "Act") sets the rules. The Act allows a landlord to end a lease without grounds, and the Act does not limit how often rent can rise.' }, ...WP.slice(7)];
/** A Word list with automatic numbering. */
const WPL = [...WP.slice(0, 11), { li: 'End no-grounds evictions for all residential leases.' }, { li: 'Limit rent increases to once every twelve months.' }, { li: 'Fund tenant advocacy services to meet demand.' }, ...WP.slice(14)];

const clone = (m) => structuredClone(m);
const idx = (m, pred) => m.findIndex(pred);
const paraWith = (m, s) => idx(m, (x) => 'p' in x && x.p.includes(s));

/** Each case: name, mutation of BASE, formats, and expected change categories (metadata and trivial excluded). */
const CASES = [
  { name: 'identical', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => m, expect: [] },
  { name: 'paragraph-removed', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => { m.splice(paraWith(m, 'Hosting, domain'), 1); return m; }, expect: ['removed'] },
  { name: 'section-removed', formats: ['docx', 'pdf', 'md'], edit: (m) => { const i = idx(m, (x) => x.text === '4. Termination'); m.splice(i, 3); return m; }, expect: ['removed', 'numbering'] },
  { name: 'typo-introduced', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => { const i = paraWith(m, 'we will receive'); m[i].p = m[i].p.replace('receive', 'recieve'); return m; }, expect: ['typo'] },
  { name: 'typo-corrected', formats: ['docx', 'md', 'txt'], original: (m) => { const i = paraWith(m, 'we will receive'); m[i].p = m[i].p.replace('receive', 'recieve'); return m; }, edit: (m) => { const i = paraWith(m, 'we will recieve'); m[i].p = m[i].p.replace('recieve', 'receive'); return m; }, expect: ['typo'] },
  { name: 'number-changed', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => { const i = paraWith(m, '30 days'); m[i].p = m[i].p.replace('30 days', '60 days'); m[i].bold = 'payable within 60 days'; return m; }, expect: ['number'] },
  { name: 'heading-level', formats: ['docx', 'pdf', 'md'], edit: (m) => { m[idx(m, (x) => x.text === '3. Deliverables')].h = 3; return m; }, expect: ['formatting'] },
  { name: 'bold-removed', formats: ['docx', 'pdf', 'md'], edit: (m) => { delete m[paraWith(m, '30 days')].bold; return m; }, expect: ['formatting'] },
  { name: 'font-changed', formats: ['docx', 'pdf'], edit: (m) => { m[paraWith(m, 'A deposit')].font = 'Times New Roman'; return m; }, expect: ['formatting'] },
  { name: 'paragraph-moved', formats: ['docx', 'pdf', 'md', 'txt'], edit: (m) => { const [p] = m.splice(paraWith(m, 'Hosting, domain'), 1); m.splice(paraWith(m, 'On termination') + 1, 0, p); return m; }, expect: ['moved'] },
  { name: 'table-row-removed', formats: ['docx', 'md'], edit: (m) => { m[idx(m, (x) => 'table' in x)].table.splice(2, 1); return m; }, expect: ['removed'] },
  // ---- addendum §0.1 use cases, on the white-paper base. redMeta: red file-detail findings expected (patterns). ----
  { name: 'uc01-caveat-dropped', base: WP, formats: ['docx', 'md', 'pdf'], edit: (m) => { m.splice(paraWith(m, 'These figures cover'), 1); return m; }, expect: ['removed'] },
  { name: 'uc01-section-tightened', base: WP, formats: ['docx', 'md'], edit: (m) => { m[paraWith(m, 'Families who are forced')].p = 'Families who are forced to move often lose contact with schools.'; m[paraWith(m, 'Older renters')].p = 'Older renters face particular difficulty.'; return m; }, expect: ['wording', 'wording'], redMeta: ['Section "4\\. Impact on families" lost \\d+% of its words'] },
  { name: 'uc02-statistic-changed', base: WP, formats: ['docx', 'md', 'pdf'], edit: (m) => { const i = paraWith(m, 'Around 42%'); m[i].p = m[i].p.replace('42%', '24%'); return m; }, expect: ['number'] },
  { name: 'uc03-heading-removed', base: WP, formats: ['docx', 'md'], edit: (m) => { m.splice(idx(m, (x) => x.text === '2. Evidence'), 1); return m; }, expect: ['removed', 'numbering'] },
  { name: 'uc07-table-row-lost', base: WP, formats: ['docx', 'md'], edit: (m) => { m[idx(m, (x) => 'table' in x)].table.splice(2, 1); return m; }, expect: ['removed'] },
  { name: 'uc09-heading-level', base: WP, formats: ['docx', 'md', 'pdf'], edit: (m) => { m[idx(m, (x) => x.text === '3. Recommendations')].h = 3; return m; }, expect: ['formatting'] },
  // ---- phase 3: new claims, quotes, limits, required headings, version numbers ----
  { name: 'uc04-invented-claims', base: WP, formats: ['docx', 'md'], edit: (m) => { m.splice(paraWith(m, 'Around 42%') + 1, 0, { p: 'A 2021 survey by the Housing Research Centre found that 67% of renters had moved at least twice, and one landlord said "the market simply cannot keep up with demand" (Smith et al., 2021).' }); return m; }, expect: ['added', 'newClaim', 'newClaim', 'newClaim', 'newClaim'] },
  { name: 'uc04-statistic-inserted', base: WP, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, 'These figures cover'); m[i].p = m[i].p.replace('social housing,', 'social housing, which houses about 85,000 households across the state,'); return m; }, expect: ['wording', 'newClaim'] },
  { name: 'uc05-quote-changed', base: WP, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, 'One tenant told us'); m[i].p = m[i].p.replace('every lease ended', 'each lease ended'); return m; }, expect: ['wording', 'quote'] },
  { name: 'uc06-over-word-limit', base: WP, formats: ['docx', 'md'], settings: { wordLimit: 250 }, edit: (m) => m, expect: ['wordLimit'] },
  { name: 'uc03-required-heading-missing', base: WP, formats: ['docx', 'md'], settings: { requiredHeadings: ['Background', 'Evidence', 'Recommendations', 'Costings'] }, edit: (m) => m, expect: ['requiredHeading'] },
  { name: 'uc03-required-heading-order', base: WP, formats: ['md'], settings: { requiredHeadings: ['2. Evidence', '1. Background'] }, edit: (m) => m, expect: ['requiredHeading'] },
  { name: 'uc11-version-not-updated', base: VWP, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, 'Around 42%'); m[i].p = m[i].p.replace('42%', '24%'); return m; }, expect: ['number', 'versionNumber'] },
  { name: 'uc11-version-backwards', base: VWP, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, 'Version 1.2'); m[i].p = m[i].p.replace('1.2', '1.1'); return m; }, expect: ['number', 'versionNumber'] },
  // ---- phase 4: references and citations, numbering, spelling and terminology ----
  { name: 'uc08-reference-removed', base: WPC, formats: ['docx', 'md', 'pdf'], edit: (m) => { m.splice(paraWith(m, '[2] NSW'), 1); return m; }, expect: ['reference', 'citation'] },
  { name: 'uc08-reference-changed', base: WPC, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, '[1] Australian'); m[i].p = m[i].p.replace('(2022)', '(2021)'); return m; }, expect: ['reference'] },
  { name: 'uc08-reference-invented', base: WPC, formats: ['docx', 'md'], edit: (m) => { m.push({ p: '[3] Smith, J. (2021), Rental stress in Australian cities, Housing Studies Journal 12.' }); return m; }, expect: ['reference'] },
  { name: 'uc08-references-renumbered', base: WPC, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, '[1] Australian'); const [r1, r2] = [m[i], m[i + 1]]; m[i] = { p: r2.p.replace('[2]', '[1]') }; m[i + 1] = { p: r1.p.replace('[1]', '[2]') }; return m; }, expect: ['reference', 'citation', 'citation'] },
  { name: 'uc08-footnote-removed', base: WPF, formats: ['docx', 'md', 'pdf'], edit: (m) => { delete m[paraWith(m, 'These figures cover')].fn; return m; }, expect: ['reference'] },
  { name: 'uc08-footnote-moved', base: WPF, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, 'These figures cover'); m[i + 1].fn = m[i].fn; delete m[i].fn; return m; }, expect: ['citation', 'citation'] },
  { name: 'uc10-numbering-gap', base: WP, formats: ['docx', 'md', 'pdf'], edit: (m) => { m.splice(paraWith(m, '2. Limit rent'), 1); return m; }, expect: ['removed', 'numbering'] },
  { name: 'uc10-renumbered', base: WP, formats: ['docx', 'md'], edit: (m) => { m.splice(paraWith(m, '2. Limit rent'), 1); const i = paraWith(m, '3. Fund'); m[i].p = m[i].p.replace('3. Fund', '2. Fund'); return m; }, expect: ['removed', 'numbering'] },
  { name: 'uc10-list-renumbered', base: WPL, formats: ['docx', 'md'], edit: (m) => { m.splice(idx(m, (x) => 'li' in x && x.li.startsWith('Limit')), 1); return m; }, expect: ['removed', 'numbering'] },
  { name: 'uc07-figure-order', base: WP, formats: ['docx', 'md'], original: (m) => { m.splice(paraWith(m, 'Our caseworkers') + 1, 0, { p: 'Figure 1: Notices to vacate by year.' }, { p: 'Figure 2: Households assisted by year.' }); return m; }, edit: (m) => { const i = paraWith(m, 'Figure 1:'); [m[i], m[i + 1]] = [m[i + 1], m[i]]; return m; }, expect: ['moved', 'numbering', 'numbering'] },
  { name: 'uc12-spelling-switched', base: WPS, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, 'Our organisation'); m[i].p = 'Our organization analyzed the behavior of landlords and prioritized the center of each neighborhood, recognizing that color and favor play no part.'; return m; }, expect: ['wording', 'spelling'] },
  { name: 'uc12-defined-term-replaced', base: WPS, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, 'The Residential Tenancies Act'); m[i].p = 'The Residential Tenancies Act 2010 sets the rules. The law allows a landlord to end a lease without grounds, and the law does not limit how often rent can rise.'; return m; }, expect: ['wording', 'terminology'] },
  { name: 'uc12-acronym-unexplained', base: WP, formats: ['docx', 'md'], edit: (m) => { const i = paraWith(m, 'Older renters'); m[i].p = m[i].p.replace('services they depend on.', 'services they depend on, such as the CRA.'); return m; }, expect: ['wording', 'terminology'] },
  { name: 'whitespace-quotes', formats: ['docx', 'md', 'txt'], trivial: true, edit: (m) => m.map((x) => ('p' in x ? { ...x, p: x.p.replace(/'/g, '’').replace(/, /g, ',  ').replace('each review', 'each review') + '  ' } : x)), expect: [] },
];

// ---------- writers ----------

/** List items numbered as they would be shown (1., 2., … within a run of items). */
const listNumbers = (m) => { let n = 0; return m.map((x) => ('li' in x ? ++n : (n = 0, 0))); };

function toTxt(m) {
  const nums = listNumbers(m);
  return m.map((x, i) => ('h' in x ? x.text : 'li' in x ? `${nums[i]}. ${x.li}` : 'p' in x ? x.p : x.table.map((r) => r.join(' | ')).join('\n'))).join('\n\n') + '\n';
}

function toMd(m) {
  const nums = listNumbers(m);
  const notes = [];
  const body = m.map((x, i) => {
    if ('h' in x) return `${'#'.repeat(x.h)} ${x.text}`;
    if ('li' in x) return `${nums[i]}. ${x.li}`;
    if ('p' in x) {
      const p = x.bold ? x.p.replace(x.bold, `**${x.bold}**`) : x.p;
      if (!x.fn) return p;
      notes.push(x.fn);
      return `${p}[^${notes.length}]`;
    }
    const [head, ...rows] = x.table;
    return [`| ${head.join(' | ')} |`, `|${head.map(() => ' --- ').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  });
  return [...body, ...notes.map((n, i) => `[^${i + 1}]: ${n}`)].join('\n\n') + '\n';
}

const segments = (x) => {
  if (!x.bold || !x.p.includes(x.bold)) return [{ text: x.p }];
  const i = x.p.indexOf(x.bold);
  return [{ text: x.p.slice(0, i) }, { text: x.bold, bold: true }, { text: x.p.slice(i + x.bold.length) }].filter((s) => s.text);
};

async function toDocx(m) {
  const HL = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  const footnotes = {};
  const children = m.map((x) => {
    if ('h' in x) return new Paragraph({ heading: HL[x.h], children: [new TextRun(x.text)] });
    if ('li' in x) return new Paragraph({ numbering: { reference: 'recs', level: 0 }, children: [new TextRun(x.li)] });
    if ('p' in x) {
      const runs = segments(x).map((s) => new TextRun({ text: s.text, bold: s.bold, font: x.font }));
      if (x.fn) { const n = Object.keys(footnotes).length + 1; footnotes[n] = { children: [new Paragraph(x.fn)] }; runs.push(new FootnoteReferenceRun(n)); }
      return new Paragraph({ children: runs });
    }
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: x.table.map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [new Paragraph(c)] })) })) });
  });
  const numbering = { config: [{ reference: 'recs', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START }] }] };
  const doc = new Document({ creator: 'DocCompare fixtures', title: 'Fixture', footnotes, numbering, sections: [{ children }] });
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
  let notesOnPage = 0, noteNo = 0;
  const ensure = (h) => { if (y - h < bottom) { page = pdf.addPage([595, 842]); y = 790; notesOnPage = 0; } };
  const nums = listNumbers(m);
  for (const [k, item] of m.entries()) {
    const x = 'li' in item ? { p: `${nums[k]}. ${item.li}` } : item;
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
        if (x.fn && line === lines[lines.length - 1]) {
          noteNo++;
          page.drawText(String(noteNo), { x: cx + 1, y: y + 4, size: 7, font: F.regular });
          page.drawText(`${noteNo} ${x.fn}`, { x: left, y: 40 - notesOnPage * 10, size: 8, font: F.regular });
          notesOnPage++;
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
 *   expect: { categories: string[], trivial?: boolean, redMeta?: string[], settings?: Partial<import('../../src/settings').Settings>, gate?: 'type-mismatch' | 'similarity' } }[]>}
 */
export async function buildFixtures() {
  const out = [];
  for (const c of CASES) {
    for (const type of c.formats) {
      const orig = (c.original ?? ((m) => m))(clone(c.base ?? BASE));
      const edited = c.edit(clone(orig));
      out.push({ name: `${c.name}.${type}`, type, original: { name: `original.${type}`, bytes: await WRITERS[type](orig) }, edited: { name: `edited.${type}`, bytes: await WRITERS[type](edited) }, expect: { categories: c.expect, trivial: !!c.trivial, redMeta: c.redMeta ?? [], settings: c.settings } });
    }
  }
  for (const type of ['md', 'docx']) {
    out.push({ name: `unrelated.${type}`, type, original: { name: `original.${type}`, bytes: await WRITERS[type](clone(BASE)) }, edited: { name: `edited.${type}`, bytes: await WRITERS[type](clone(UNRELATED)) }, expect: { categories: [], gate: 'similarity' } });
  }
  out.push({ name: 'mismatched-types', type: 'mixed', original: { name: 'original.docx', bytes: await toDocx(BASE) }, edited: { name: 'edited.pdf', bytes: await toPdf(BASE) }, expect: { categories: [], gate: 'type-mismatch' } });
  return out;
}
