import type { Root, RootContent, PhrasingContent, List } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { finalize, isBinary, readText, type RawBlock } from './finalize';
import type { Note, Reader, Run } from './types';

type Fmt = Omit<Run, 'text'>;

/** `refs` collects the notes the text points to: footnote marks [^1] and reference-style links [text][label]. */
function inlineRuns(nodes: PhrasingContent[], fmt: Fmt, out: Run[], refs: string[] = []): void {
  for (const n of nodes) {
    switch (n.type) {
      case 'text': out.push({ ...fmt, text: n.value }); break;
      case 'inlineCode': out.push({ ...fmt, font: 'monospace', text: n.value }); break;
      case 'break': out.push({ ...fmt, text: '\n' }); break;
      case 'strong': inlineRuns(n.children, { ...fmt, bold: true }, out, refs); break;
      case 'emphasis': inlineRuns(n.children, { ...fmt, italic: true }, out, refs); break;
      case 'delete': inlineRuns(n.children, { ...fmt, strike: true }, out, refs); break;
      case 'link': inlineRuns(n.children, { ...fmt, link: n.url }, out, refs); break;
      case 'footnoteReference': refs.push(`fn:${n.identifier}`); break;
      case 'linkReference': refs.push(`link:${n.identifier}`); inlineRuns(n.children, fmt, out, refs); break;
      case 'html': out.push({ ...fmt, text: n.value }); break;
      default: if ('children' in n) inlineRuns(n.children as PhrasingContent[], fmt, out, refs);
    }
  }
}

const runsText = (runs: Run[]) => runs.map((r) => r.text).join('');
const countImages = (n: unknown): number => {
  const node = n as { type: string; children?: unknown[] };
  return (node.type === 'image' || node.type === 'imageReference' ? 1 : 0) + (node.children ?? []).reduce<number>((s, c) => s + countImages(c), 0);
};

const withNotes = (refs: string[]) => (refs.length ? { notes: refs } : {});

function walk(nodes: RootContent[], out: RawBlock[], ctx: { table: number; notes: Note[]; list?: { depth: number; kind: string }; quote?: boolean }): void {
  for (const n of nodes) {
    // containers (lists, quotes) recurse, so only leaf blocks count their images
    const imgs = n.type === 'heading' || n.type === 'paragraph' || n.type === 'table' ? countImages(n) : 0;
    switch (n.type) {
      case 'heading': {
        const runs: Run[] = [], refs: string[] = []; inlineRuns(n.children, {}, runs, refs);
        out.push({ type: 'heading', level: n.depth, text: runsText(runs), runs, ...withNotes(refs) });
        break;
      }
      case 'paragraph': {
        const runs: Run[] = [], refs: string[] = []; inlineRuns(n.children, {}, runs, refs);
        const text = runsText(runs);
        if (ctx.list) out.push({ type: 'listItem', level: ctx.list.depth, style: ctx.list.kind, text, runs, ...withNotes(refs) });
        else if (text.trim()) out.push({ type: 'paragraph', style: ctx.quote ? 'quote' : undefined, text, runs, ...withNotes(refs) });
        break;
      }
      case 'list': {
        const l = n as List;
        const depth = (ctx.list?.depth ?? 0) + 1;
        l.children.forEach((item, i) => {
          const first = out.length;
          walk(item.children, out, { ...ctx, list: { depth, kind: l.ordered ? 'ordered list' : 'bullet list' } });
          // Markdown renumbers ordered lists itself: the number shown is the list's start plus the item's position
          if (l.ordered && out[first]?.type === 'listItem') out[first].number = `${(l.start ?? 1) + i}.`;
        });
        break;
      }
      case 'blockquote': walk(n.children, out, { ...ctx, quote: true }); break; // its paragraphs are direct quotes (checks/quotes.ts)
      case 'code': out.push({ type: 'other', style: `code${n.lang ? `:${n.lang}` : ''}`, text: n.value, runs: [{ text: n.value, font: 'monospace' }] }); break;
      case 'html': if (n.value.trim()) out.push({ type: 'other', style: 'html', text: n.value, runs: [{ text: n.value }] }); break;
      case 'thematicBreak': break;
      case 'footnoteDefinition': {
        const inner: RawBlock[] = [];
        walk(n.children, inner, { ...ctx, list: undefined });
        ctx.notes.push({ id: `fn:${n.identifier}`, kind: 'footnote', label: n.label ?? n.identifier, text: inner.map((b) => b.text).join(' ').trim() });
        break;
      }
      case 'definition': ctx.notes.push({ id: `link:${n.identifier}`, kind: 'link', label: n.label ?? n.identifier, text: [n.url, n.title].filter(Boolean).join(' ') }); break;
      case 'table': {
        const t = ctx.table++;
        n.children.forEach((row, r) => row.children.forEach((cell, c) => {
          const runs: Run[] = [], refs: string[] = []; inlineRuns(cell.children, {}, runs, refs);
          out.push({ type: 'tableCell', text: runsText(runs), runs, ...withNotes(refs), location: { table: { t, r, c } } });
        }));
        break;
      }
      default: if ('children' in n) walk(n.children as RootContent[], out, ctx);
    }
    // images inside a paragraph keep the paragraph and add an image block so counts and removals show up
    for (let i = 0; i < imgs; i++) out.push({ type: 'image', text: '', runs: [] });
  }
}

export const markdownReader: Reader = {
  id: 'md',
  label: 'Markdown',
  extensions: ['.md', '.markdown'],
  sniff: (bytes, name) => !isBinary(bytes) && /\.(md|markdown)$/i.test(name),
  async read(file) {
    const tree = unified().use(remarkParse).use(remarkGfm).parse(await readText(file)) as Root;
    const blocks: RawBlock[] = [];
    const notes: Note[] = [];
    walk(tree.children, blocks, { table: 0, notes });
    return finalize(file, 'md', blocks, {}, undefined, notes);
  },
};
