import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { finalize, type RawBlock } from './finalize';
import { GateError, type Note, type Reader, type Run } from './types';

/** preserveOrder output: each node is { tagName: children[], ':@': attrs } or { '#text': string }. */
type XNode = Record<string, unknown>;
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', trimValues: false, parseTagValue: false, parseAttributeValue: false });

const tagOf = (n: XNode) => Object.keys(n).find((k) => k !== ':@') ?? '';
const kids = (n: XNode | undefined): XNode[] => (n ? ((n[tagOf(n)] as XNode[]) ?? []) : []);
const attr = (n: XNode | undefined, a: string): string | undefined => (n?.[':@'] as Record<string, string> | undefined)?.[a];
const child = (n: XNode | undefined, t: string) => kids(n).find((c) => tagOf(c) === t);
const textOf = (nodes: XNode[]): string => nodes.map((c) => (typeof c['#text'] === 'string' ? (c['#text'] as string) : textOf(kids(c)))).join('');
const parse = (xml: string) => parser.parse(xml) as XNode[];
const findDeep = (nodes: XNode[], t: string): XNode | undefined => {
  for (const n of nodes) { if (tagOf(n) === t) return n; const f = findDeep(kids(n), t); if (f) return f; }
  return undefined;
};

type Fmt = Omit<Run, 'text'>;
/** w:b / w:i etc. are on when present, unless w:val is 0/false/none. */
const onOff = (n: XNode | undefined) => (n ? !['0', 'false', 'off', 'none'].includes(attr(n, 'w:val') ?? '') : undefined);

/** Theme fonts (word/theme/theme1.xml), referenced by w:asciiTheme="minorHAnsi" etc. Set once per document read. */
let themeFonts: { major?: string; minor?: string } = {};
// Word's own fallback when neither the document nor its theme names a font; shown as such rather than guessed
const DEFAULT_FONT = 'Default font';

function readRPr(rPr: XNode | undefined): Fmt {
  if (!rPr) return {};
  const f: Fmt = {};
  const set = <K extends keyof Fmt>(k: K, v: Fmt[K] | undefined) => { if (v !== undefined) f[k] = v; };
  set('bold', onOff(child(rPr, 'w:b')));
  set('italic', onOff(child(rPr, 'w:i')));
  set('underline', onOff(child(rPr, 'w:u')));
  set('strike', onOff(child(rPr, 'w:strike')) || onOff(child(rPr, 'w:dstrike')) || undefined);
  const fonts = child(rPr, 'w:rFonts');
  const theme = attr(fonts, 'w:asciiTheme') ?? attr(fonts, 'w:hAnsiTheme');
  set('font', attr(fonts, 'w:ascii') ?? attr(fonts, 'w:hAnsi') ?? (theme ? (theme.startsWith('major') ? themeFonts.major : themeFonts.minor) : undefined));
  const sz = attr(child(rPr, 'w:sz'), 'w:val');
  if (sz) f.sizePt = Number(sz) / 2;
  const color = attr(child(rPr, 'w:color'), 'w:val');
  if (color && color !== 'auto') f.color = color.toUpperCase();
  return f;
}

interface StyleInfo { name: string; basedOn?: string; rPr: Fmt; headingLevel?: number; list?: boolean; numId?: string; ilvl?: number }

function readStyles(xml: string | undefined): { styles: Map<string, StyleInfo>; defaults: Fmt } {
  const styles = new Map<string, StyleInfo>();
  if (!xml) return { styles, defaults: {} };
  const root = findDeep(parse(xml), 'w:styles');
  const defaults = readRPr(child(child(child(root, 'w:docDefaults'), 'w:rPrDefault'), 'w:rPr'));
  for (const s of kids(root).filter((n) => tagOf(n) === 'w:style')) {
    const id = attr(s, 'w:styleId');
    if (!id) continue;
    const name = attr(child(s, 'w:name'), 'w:val') ?? id;
    const pPr = child(s, 'w:pPr');
    const outline = attr(child(pPr, 'w:outlineLvl'), 'w:val');
    const h = /^heading\s*(\d)$/i.exec(name);
    styles.set(id, {
      name: name.replace(/^heading(\d)$/i, 'Heading $1').replace(/^heading /, 'Heading '),
      basedOn: attr(child(s, 'w:basedOn'), 'w:val'),
      rPr: readRPr(child(s, 'w:rPr')),
      headingLevel: h ? Number(h[1]) : outline !== undefined ? Number(outline) + 1 : undefined,
      list: !!child(pPr, 'w:numPr'),
      numId: attr(child(child(pPr, 'w:numPr'), 'w:numId'), 'w:val'),
      ilvl: Number(attr(child(child(pPr, 'w:numPr'), 'w:ilvl'), 'w:val') ?? 0),
    });
  }
  return { styles, defaults };
}

/** Effective style formatting: basedOn chain, base first. */
function styleChain(styles: Map<string, StyleInfo>, id: string | undefined): StyleInfo[] {
  const chain: StyleInfo[] = [];
  for (let s = id ? styles.get(id) : undefined, guard = 0; s && guard < 20; s = s.basedOn ? styles.get(s.basedOn) : undefined, guard++) chain.unshift(s);
  return chain;
}

// ---- automatic numbering (word/numbering.xml): what Word draws in front of a numbered paragraph ----
interface Lvl { start: number; fmt: string; text: string }
type Numbering = Map<string, { lvls: Lvl[]; starts: Map<number, number> }>;

function readNumbering(xml: string | undefined): Numbering {
  const out: Numbering = new Map();
  if (!xml) return out;
  const root = findDeep(parse(xml), 'w:numbering');
  const abstract = new Map<string, Lvl[]>();
  for (const an of kids(root).filter((n) => tagOf(n) === 'w:abstractNum')) {
    const lvls: Lvl[] = [];
    for (const l of kids(an).filter((n) => tagOf(n) === 'w:lvl')) {
      lvls[Number(attr(l, 'w:ilvl') ?? 0)] = { start: Number(attr(child(l, 'w:start'), 'w:val') ?? 1), fmt: attr(child(l, 'w:numFmt'), 'w:val') ?? 'decimal', text: attr(child(l, 'w:lvlText'), 'w:val') ?? '' };
    }
    abstract.set(attr(an, 'w:abstractNumId') ?? '', lvls);
  }
  for (const n of kids(root).filter((x) => tagOf(x) === 'w:num')) {
    const starts = new Map<number, number>();
    for (const o of kids(n).filter((x) => tagOf(x) === 'w:lvlOverride')) {
      const s = attr(child(o, 'w:startOverride'), 'w:val');
      if (s !== undefined) starts.set(Number(attr(o, 'w:ilvl') ?? 0), Number(s));
    }
    out.set(attr(n, 'w:numId') ?? '', { lvls: abstract.get(attr(child(n, 'w:abstractNumId'), 'w:val') ?? '') ?? [], starts });
  }
  return out;
}

const roman = (n: number) => { let s = ''; for (const [v, r] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']] as const) while (n >= v) { s += r; n -= v; } return s; };
const letter = (n: number) => String.fromCharCode(96 + (((n - 1) % 26) + 1)).repeat(Math.floor((n - 1) / 26) + 1);
function fmtNum(n: number, fmt: string): string {
  switch (fmt) {
    case 'lowerLetter': return letter(n);
    case 'upperLetter': return letter(n).toUpperCase();
    case 'lowerRoman': return roman(n);
    case 'upperRoman': return roman(n).toUpperCase();
    case 'decimalZero': return String(n).padStart(2, '0');
    default: return String(n);
  }
}

/** Keeps the counters per list while the body is read, and renders "%1.%2." into "2.1.". Bullets get no number. */
function numberer(numbering: Numbering) {
  const counters = new Map<string, number[]>();
  return (numId: string | undefined, ilvl: number): string | undefined => {
    const def = numId && numId !== '0' ? numbering.get(numId) : undefined;
    const lvl = def?.lvls[ilvl];
    if (!def || !lvl || lvl.fmt === 'bullet' || lvl.fmt === 'none') return undefined;
    const c = counters.get(numId!) ?? [];
    const startOf = (i: number) => def.starts.get(i) ?? def.lvls[i]?.start ?? 1;
    c[ilvl] = c[ilvl] === undefined ? startOf(ilvl) : c[ilvl] + 1;
    c.length = ilvl + 1; // deeper levels start again
    counters.set(numId!, c);
    return lvl.text.replace(/%(\d)/g, (_, k) => { const i = Number(k) - 1; return fmtNum(c[i] ?? startOf(i), def.lvls[i]?.fmt ?? 'decimal'); }).trim() || undefined;
  };
}

function readRels(xml: string | undefined): Map<string, string> {
  const rels = new Map<string, string>();
  if (!xml) return rels;
  for (const r of kids(findDeep(parse(xml), 'Relationships'))) { const id = attr(r, 'Id'); const target = attr(r, 'Target'); if (id && target) rels.set(id, target); }
  return rels;
}

function readCore(xml: string | undefined, app: string | undefined) {
  const meta: Record<string, string | Date | number | undefined> = {};
  const date = (s: string) => { const d = new Date(s.trim()); return isNaN(+d) ? undefined : d; };
  if (xml) {
    const root = kids(findDeep(parse(xml), 'cp:coreProperties'));
    const get = (t: string) => { const n = root.find((c) => tagOf(c) === t); const v = n ? textOf(kids(n)).trim() : ''; return v || undefined; };
    meta.author = get('dc:creator');
    meta.lastModifiedBy = get('cp:lastModifiedBy');
    meta.revision = get('cp:revision');
    meta.title = get('dc:title');
    const c = get('dcterms:created'); if (c) meta.created = date(c);
    const m = get('dcterms:modified'); if (m) meta.modified = date(m);
  }
  if (app) {
    const root = kids(findDeep(parse(app), 'Properties'));
    const get = (t: string) => { const n = root.find((c) => tagOf(c) === t); return n ? textOf(kids(n)).trim() || undefined : undefined; };
    const appName = get('Application'); const ver = get('AppVersion');
    meta.application = appName ? `${appName}${ver ? ` ${ver}` : ''}` : undefined;
    const pages = Number(get('Pages'));
    if (pages > 0) meta.pageCount = pages;
  }
  return meta;
}

export const docxReader: Reader = {
  id: 'docx',
  label: 'Word (DOCX)',
  extensions: ['.docx'],
  sniff(bytes) {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return false; // ZIP
    // the entry name appears in plain ASCII in the local and central headers
    const needle = new TextEncoder().encode('word/document.xml');
    outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
      for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  },
  async read(file) {
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch { throw new GateError('corrupt', `${file.name} could not be opened: the DOCX file looks damaged.`); }
    const get = (p: string) => zip.file(p)?.async('string');
    const docXml = await get('word/document.xml');
    if (!docXml) throw new GateError('corrupt', `${file.name} has no word/document.xml; it is not a valid DOCX file.`);
    const [stylesXml, relsXml, coreXml, appXml, themeXml, numberingXml, footnotesXml, endnotesXml] = await Promise.all([get('word/styles.xml'), get('word/_rels/document.xml.rels'), get('docProps/core.xml'), get('docProps/app.xml'), get('word/theme/theme1.xml'), get('word/numbering.xml'), get('word/footnotes.xml'), get('word/endnotes.xml')]);
    themeFonts = {};
    if (themeXml) {
      const scheme = findDeep(parse(themeXml), 'a:fontScheme');
      themeFonts = { major: attr(child(child(scheme, 'a:majorFont'), 'a:latin'), 'typeface'), minor: attr(child(child(scheme, 'a:minorFont'), 'a:latin'), 'typeface') };
    }
    const { styles, defaults } = readStyles(stylesXml);
    defaults.font ??= themeFonts.minor ?? DEFAULT_FONT;
    const rels = readRels(relsXml);
    const body = findDeep(parse(docXml), 'w:body');
    const out: RawBlock[] = [];
    let tableNo = 0;
    const nextNumber = numberer(readNumbering(numberingXml));

    const paragraph = (p: XNode, table?: { t: number; r: number; c: number }): { runs: Run[]; pageBreakAfter: boolean; images: number; styleName?: string; level?: number; type: RawBlock['type']; notes: string[]; numId?: string; ilvl: number } => {
      const pPr = child(p, 'w:pPr');
      const styleId = attr(child(pPr, 'w:pStyle'), 'w:val');
      const chain = styleChain(styles, styleId);
      const pStyle = chain[chain.length - 1];
      const numPr = child(pPr, 'w:numPr');
      const outline = attr(child(pPr, 'w:outlineLvl'), 'w:val');
      const headingLevel = [...chain].reverse().find((s) => s.headingLevel)?.headingLevel ?? (outline !== undefined && Number(outline) < 9 ? Number(outline) + 1 : undefined);
      const isList = !!numPr || chain.some((s) => s.list);
      const baseFmt: Fmt = Object.assign({}, defaults, ...chain.map((s) => s.rPr));
      const runs: Run[] = [];
      let pageBreakAfter = false, images = 0;
      const notes: string[] = [];
      const walkRuns = (nodes: XNode[], link?: string) => {
        for (const n of nodes) {
          const t = tagOf(n);
          if (t === 'w:r') {
            const rPr = child(n, 'w:rPr');
            const rStyleId = attr(child(rPr, 'w:rStyle'), 'w:val');
            const rChain = styleChain(styles, rStyleId);
            const fmt: Fmt = Object.assign({}, baseFmt, ...rChain.map((s) => s.rPr), readRPr(rPr));
            if (rStyleId) fmt.style = styles.get(rStyleId)?.name ?? rStyleId;
            if (link) fmt.link = link;
            let text = '';
            for (const c of kids(n)) {
              const ct = tagOf(c);
              if (ct === 'w:t') text += textOf(kids(c));
              else if (ct === 'w:tab') text += '\t';
              else if (ct === 'w:br' || ct === 'w:cr') { if (attr(c, 'w:type') === 'page') pageBreakAfter = true; else text += '\n'; }
              else if (ct === 'w:noBreakHyphen') text += '‑';
              else if (ct === 'w:drawing' || ct === 'w:pict' || ct === 'w:object') images++;
              else if (ct === 'w:footnoteReference' || ct === 'w:endnoteReference') notes.push(`${ct === 'w:footnoteReference' ? 'fn' : 'en'}:${attr(c, 'w:id')}`);
            }
            if (text) runs.push({ ...fmt, text });
          } else if (t === 'w:hyperlink') {
            const rid = attr(n, 'r:id');
            walkRuns(kids(n), (rid && rels.get(rid)) ?? (attr(n, 'w:anchor') ? `#${attr(n, 'w:anchor')}` : link));
          } else if (t === 'w:del' || t === 'w:moveFrom' || t === 'w:pPr') {
            // tracked deletions are not part of the visible text
          } else if (t === 'w:sdtContent' || t === 'w:sdt' || t === 'w:ins' || t === 'w:moveTo' || t === 'w:smartTag' || t === 'w:fldSimple' || t === 'w:customXml') {
            walkRuns(kids(n), link);
          }
        }
      };
      walkRuns(kids(p));
      return {
        runs,
        pageBreakAfter: pageBreakAfter || !!child(pPr, 'w:pageBreakBefore'),
        images,
        styleName: pStyle?.name,
        type: table ? 'tableCell' : headingLevel ? 'heading' : isList ? 'listItem' : 'paragraph',
        level: headingLevel ?? (isList ? Number(attr(child(numPr, 'w:ilvl'), 'w:val') ?? 0) + 1 : undefined),
        notes,
        numId: attr(child(numPr, 'w:numId'), 'w:val') ?? [...chain].reverse().find((s) => s.numId)?.numId,
        ilvl: Number(attr(child(numPr, 'w:ilvl'), 'w:val') ?? [...chain].reverse().find((s) => s.numId)?.ilvl ?? 0),
      };
    };

    const walkBody = (nodes: XNode[]) => {
      for (const n of nodes) {
        const t = tagOf(n);
        if (t === 'w:p') {
          const p = paragraph(n);
          const text = p.runs.map((r) => r.text).join('');
          const number = nextNumber(p.numId, p.ilvl);
          if (text.trim() || p.type === 'heading') out.push({ type: p.type, level: p.level, style: p.styleName, text, runs: p.runs, ...(number ? { number } : {}), ...(p.notes.length ? { notes: p.notes } : {}) });
          for (let i = 0; i < p.images; i++) out.push({ type: 'image', text: '', runs: [] });
          if (p.pageBreakAfter) out.push({ type: 'pageBreak', text: '', runs: [] });
        } else if (t === 'w:tbl') {
          const tIdx = tableNo++;
          kids(n).filter((r) => tagOf(r) === 'w:tr').forEach((tr, r) => {
            let c = 0;
            for (const tc of kids(tr).filter((x) => tagOf(x) === 'w:tc')) {
              const span = Number(attr(child(child(tc, 'w:tcPr'), 'w:gridSpan'), 'w:val') ?? 1);
              const runs: Run[] = [];
              const notes: string[] = [];
              let images = 0;
              // a cell holds paragraphs (and possibly nested tables, flattened into the cell text)
              const cellParas = (xs: XNode[]) => xs.forEach((x) => {
                if (tagOf(x) === 'w:p') { const p = paragraph(x, { t: tIdx, r, c }); if (runs.length && p.runs.length) runs.push({ text: '\n' }); runs.push(...p.runs); notes.push(...p.notes); images += p.images; }
                else if (tagOf(x) === 'w:tbl' || tagOf(x) === 'w:tr' || tagOf(x) === 'w:tc' || tagOf(x) === 'w:sdt' || tagOf(x) === 'w:sdtContent') cellParas(kids(x));
              });
              cellParas(kids(tc));
              out.push({ type: 'tableCell', text: runs.map((x) => x.text).join(''), runs, ...(notes.length ? { notes } : {}), location: { table: { t: tIdx, r, c } } });
              for (let i = 0; i < images; i++) out.push({ type: 'image', text: '', runs: [] });
              c += span;
            }
          });
        } else if (t === 'w:sdt' || t === 'w:sdtContent' || t === 'w:customXml') {
          walkBody(kids(n));
        }
      }
    };
    walkBody(kids(body));
    // footnotes and endnotes, numbered as Word shows them: in the order their marks first appear
    const order = [...new Set(out.flatMap((b) => b.notes ?? []))];
    const notes: Note[] = [];
    for (const [xml, kind, tag, prefix] of [[footnotesXml, 'footnote', 'w:footnote', 'fn'], [endnotesXml, 'endnote', 'w:endnote', 'en']] as const) {
      if (!xml) continue;
      for (const n of kids(findDeep(parse(xml), `${tag}s`)).filter((x) => tagOf(x) === tag && !attr(x, 'w:type'))) {
        const id = `${prefix}:${attr(n, 'w:id')}`;
        const text = kids(n).filter((x) => tagOf(x) === 'w:p').map((x) => paragraph(x).runs.map((r) => r.text).join('')).join(' ').trim();
        const shown = order.filter((o) => o.startsWith(prefix)).indexOf(id);
        if (text) notes.push({ id, kind, label: String(shown >= 0 ? shown + 1 : attr(n, 'w:id')), text });
      }
    }
    return finalize(file, 'docx', out, readCore(coreXml, appXml), undefined, notes);
  },
};
