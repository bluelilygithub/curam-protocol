import type { AlignOp } from '../compare/align';
import { classify, locate, type NewChange } from '../compare/content';
import { ALL_RULES, normalize } from '../compare/normalize';
import type { PostCheck } from '../compare/postChecks';
import { charDice } from '../compare/textSim';
import type { Block, NormalizedDoc, Note } from '../readers/types';
import { SEVERITY } from '../report/severity';
import { docText, referenceBlockIds } from './docText';

/**
 * References and citations (addendum §5.1). Entries come from the reference list (by heading) and from footnotes, endnotes and Markdown
 * link definitions. Entries are matched across the documents by fingerprint (text without its number and link, Dice >= 0.85), then:
 *   red    reference or footnote removed, added (also counted as a claim) or changed (authors, year, title, link)
 *   amber  the list was renumbered (citations that now point elsewhere are reported on their own, red)
 *   red    a citation in the edited version that points to nothing, or that now points to a different source / sits on different text
 * Content changes inside the reference list are left to this check (pipeline.ts), so a removed reference is one card, not two.
 */

export interface Entry {
  key: string;
  group: 'list' | 'note';
  label?: string; // "3" from "[3]" or "3.", a footnote's number, a link definition's label
  text: string;
  core: string; // what entries are matched on
  year?: string;
  authors: string;
  title: string;
  url?: string;
  block?: Block;
  note?: Note;
}

const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+|\bdoi:\s?10\.\d{4,}\/\S+|\b10\.\d{4,}\/\S+/i;
const LABEL_RE = /^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+/;
const YEAR_RE = /\b(?:19|20)\d{2}[a-z]?\b/;
export const MATCH_MIN = 0.85;
const norm = (s: string) => normalize(s, ALL_RULES).toLowerCase().replace(/\s+/g, ' ').trim();

function parseEntry(text: string, base: Pick<Entry, 'key' | 'group' | 'label' | 'block' | 'note'>): Entry {
  const lm = LABEL_RE.exec(text);
  const body = lm ? text.slice(lm[0].length) : text;
  const url = URL_RE.exec(body)?.[0].replace(/[.,;)]+$/, '');
  const rest = url ? body.replace(url, ' ') : body;
  const ym = YEAR_RE.exec(rest);
  return {
    ...base,
    label: base.label ?? lm?.[1] ?? lm?.[2],
    text: text.trim(),
    // a link definition is mostly its URL: match it on its label as well
    core: norm(base.note?.kind === 'link' ? `${base.note.label} ${body}` : rest),
    year: ym?.[0],
    authors: ym ? rest.slice(0, ym.index).replace(/[\s(,.]+$/, '').trim() : '',
    title: (ym ? rest.slice(ym.index + ym[0].length) : rest).replace(/^[\s).,:]+/, '').trim(),
    url,
  };
}

/** Reference-list entries (a PDF paragraph holding several "[n]" entries is split) and notes. */
export function referenceEntries(d: NormalizedDoc): Entry[] {
  const ids = referenceBlockIds(d);
  const out: Entry[] = [];
  for (const b of d.blocks) {
    if (!ids.has(b.id) || !b.text.trim()) continue;
    b.text.split(/(?=\[\d{1,3}\]\s)/).map((s) => s.trim()).filter(Boolean).forEach((p, i) => out.push(parseEntry(p, { key: `${b.id}:${i}`, group: 'list', block: b })));
  }
  for (const n of d.notes ?? []) out.push(parseEntry(n.text, { key: n.id, group: 'note', label: n.label, note: n }));
  return out;
}

/** Best-first one-to-one matching of entries in the same group. */
export function matchEntries(ea: Entry[], eb: Entry[]): Map<Entry, Entry> {
  const pairs: [number, Entry, Entry][] = [];
  for (const x of ea) for (const y of eb) {
    if (x.group !== y.group || (x.note && y.note && x.note.kind !== y.note.kind)) continue;
    const s = x.core === y.core ? 1 : charDice(x.core, y.core);
    if (s >= MATCH_MIN) pairs.push([s, x, y]);
  }
  pairs.sort((p, q) => q[0] - p[0]);
  const m = new Map<Entry, Entry>(), used = new Set<Entry>();
  for (const [, x, y] of pairs) if (!m.has(x) && !used.has(y)) { m.set(x, y); used.add(y); }
  return m;
}

const NOTE_NAME = { footnote: 'Footnote', endnote: 'Endnote', link: 'Link' } as const;
/** "[3]", "Footnote 2", "Link [ahuri]", or the start of the entry. */
export const entryName = (e: Entry) => (e.note ? `${NOTE_NAME[e.note.kind]} ${e.note.kind === 'link' ? `[${e.label}]` : e.label}` : e.label ? `[${e.label}]` : `"${e.text.slice(0, 40)}${e.text.length > 40 ? '…' : ''}"`);
const kindWord = (e: Entry) => (e.note ? NOTE_NAME[e.note.kind] : 'Reference');

// ---- citations ----
export interface Cite { kind: 'numeric' | 'authorYear' | 'note'; key: string; text: string; block: Block }

const AUTHOR = String.raw`[A-Z][\w'’-]+(?:\s+et al\.?|\s+(?:and|&)\s+[A-Z][\w'’-]+)?`;
const AY_PAREN = new RegExp(String.raw`\((${AUTHOR}),?\s+((?:19|20)\d{2})[a-z]?`, 'g'); // (Smith et al., 2021)
const AY_NARR = new RegExp(String.raw`\b(${AUTHOR})\s+\(((?:19|20)\d{2})[a-z]?\)`, 'g'); // Smith et al. (2021)

/** In-text citations outside the reference list: [3], [2-4], (Smith 2021), Smith et al. (2021), footnote marks. */
export function citations(d: NormalizedDoc, refIds = referenceBlockIds(d)): Cite[] {
  const out: Cite[] = [];
  for (const b of d.blocks) {
    if (refIds.has(b.id)) continue;
    for (const m of b.text.matchAll(/\[(\d{1,3}(?:\s*[-–,]\s*\d{1,3})*)\]/g)) {
      for (const part of m[1].split(',')) {
        const [x, y] = part.split(/[-–]/).map((s) => Number(s.trim()));
        for (let n = x; n <= Math.min(y || x, x + 50); n++) out.push({ kind: 'numeric', key: String(n), text: `[${n}]`, block: b });
      }
    }
    for (const re of [AY_PAREN, AY_NARR]) for (const m of b.text.matchAll(re)) {
      const surname = m[1].split(/\s/)[0];
      out.push({ kind: 'authorYear', key: `${surname.toLowerCase()} ${m[2]}`, text: `${m[1]} ${m[2]}`, block: b });
    }
    for (const id of b.notes ?? []) out.push({ kind: 'note', key: id, text: id.startsWith('en:') ? 'an endnote mark' : id.startsWith('link:') ? `the link [${id.slice(5)}]` : 'a footnote mark', block: b });
  }
  return out;
}

/** The entry a citation points to in its document, if any. */
export function resolve(c: Cite, entries: Entry[]): Entry | undefined {
  if (c.kind === 'note') return entries.find((e) => e.key === c.key);
  if (c.kind === 'numeric') {
    const list = entries.filter((e) => e.group === 'list');
    // numbered entries: by number; an unnumbered list is read in order
    return list.some((e) => e.label) ? list.find((e) => e.label === c.key) : list[Number(c.key) - 1];
  }
  const [surname, year] = c.key.split(' ');
  return entries.find((e) => e.year?.startsWith(year) && e.text.toLowerCase().includes(surname));
}

const named = (c: Cite, e: Entry | undefined) => (c.kind === 'note' && e ? entryName(e).toLowerCase() : c.text);

export const references: PostCheck = (a, b, ops, ctx) => {
  const ea = referenceEntries(a), eb = referenceEntries(b);
  if (!ea.length && !eb.length) return [];
  const best = a.sourceType === 'pdf' || b.sourceType === 'pdf' ? ' (PDF: found by best effort)' : '';
  const where = (e: Entry, edited: boolean) => (e.block ? locate(e.block, edited) : `${entryName(e)}${edited ? ' (edited)' : ''}`) + best;
  const m = matchEntries(ea, eb);
  const matched = new Set(m.values());
  const out: NewChange[] = [];
  const textA = docText(a).toLowerCase(), textB = docText(b).toLowerCase();

  for (const x of ea) {
    const y = m.get(x);
    if (!y) {
      // still in the edited text, outside the list (a renamed heading, say): not removed
      if (x.core.length > 20 && textB.includes(x.core)) continue;
      out.push({ category: 'reference', severity: SEVERITY.reference, location: where(x, false), original: x.text, detail: `${kindWord(x)} removed: ${entryName(x)}` });
      continue;
    }
    const strip = (e: Entry) => norm(e.text.replace(LABEL_RE, ''));
    if (strip(x) === strip(y)) continue;
    const what = [norm(x.authors) !== norm(y.authors) && 'authors', x.year !== y.year && 'year', norm(x.title) !== norm(y.title) && 'title', (x.url ?? '') !== (y.url ?? '') && 'link'].filter(Boolean) as string[];
    out.push({ category: 'reference', severity: SEVERITY.reference, location: where(y, true), original: x.text, edited: y.text, detail: `${kindWord(x)} changed (${what.length ? what.join(', ') : 'wording'}): ${entryName(y)}`, diffHtml: classify(norm(x.text), norm(y.text)).diffHtml });
  }
  for (const y of eb) {
    if (matched.has(y) || (y.core.length > 20 && textA.includes(y.core))) continue;
    out.push({ category: 'reference', severity: SEVERITY.reference, location: where(y, true), edited: y.text, detail: `${kindWord(y)} added: ${entryName(y)}` });
  }
  const renumbered = ea.filter((x) => x.group === 'list' && m.get(x) && x.label && m.get(x)!.label && x.label !== m.get(x)!.label);
  if (renumbered.length) {
    const show = renumbered.slice(0, 6);
    out.push({ category: 'reference', severity: SEVERITY.referenceRenumbered, location: `Reference list${best}`, original: show.map((x) => `[${x.label}]`).join(', '), edited: show.map((x) => `[${m.get(x)!.label}]`).join(', '), detail: `Reference list renumbered: ${renumbered.length} reference${renumbered.length === 1 ? '' : 's'} have a new number` });
  }

  // citations
  const ca = citations(a), cb = citations(b);
  const seen = new Set<string>();
  const push = (c: NewChange) => { const k = `${c.detail}|${c.location}`; if (!seen.has(k)) { seen.add(k); out.push(c); } };
  for (const c of cb) {
    if (resolve(c, eb)) continue;
    const before = ca.filter((x) => x.kind === c.kind && x.key === c.key);
    if (before.length && !before.some((x) => resolve(x, ea))) continue; // already pointed to nothing in the original
    // a citation that is new and already reported as an invented claim (checks/claims.ts) is one finding, not two
    const loc = locate(c.block, true);
    const claimed = ctx.changes.filter((x) => x.category === 'newClaim' && x.location === loc).map((x) => x.detail ?? '').join(' ');
    if (!before.length && claimed.includes(c.kind === 'authorYear' ? c.key.split(' ')[0].replace(/^./, (s) => s.toUpperCase()) : c.text)) continue;
    push({ category: 'citation', severity: SEVERITY.citation, location: loc + best, edited: c.block.text, detail: `Citation points to nothing: ${c.text}` });
  }
  // the same text should cite the same sources; a source cited elsewhere in the original that turns up here moved to different text
  const citedInA = new Set(ca.map((c) => resolve(c, ea)).filter(Boolean) as Entry[]);
  const byBlock = (list: Cite[], id: string) => list.filter((c) => c.block.id === id);
  for (const op of ops as AlignOp[]) {
    if (op.kind === 'removed' || op.kind === 'added') continue;
    const before = byBlock(ca, op.a.id).map((c) => ({ c, e: resolve(c, ea) })).filter((x) => x.e);
    const after = byBlock(cb, op.b.id).map((c) => ({ c, e: resolve(c, eb) })).filter((x) => x.e);
    if (!before.length && !after.length) continue;
    const afterSet = new Set(after.map((x) => x.e));
    const beforeMapped = new Set(before.map((x) => m.get(x.e!)).filter(Boolean));
    const lost = before.filter((x) => !afterSet.has(m.get(x.e!)!));
    const gained = after.filter((x) => !beforeMapped.has(x.e) && [...m.entries()].some(([ax, by]) => by === x.e && citedInA.has(ax)));
    const loc = locate(op.b, true) + best;
    if (lost.length && gained.length) {
      push({ category: 'citation', severity: SEVERITY.citation, location: loc, original: lost[0].e!.text, edited: gained[0].e!.text, detail: `Citation now points to a different source: ${named(gained[0].c, gained[0].e)}` });
    } else if (lost.some((x) => m.get(x.e!))) {
      const x = lost.find((l) => m.get(l.e!))!;
      push({ category: 'citation', severity: SEVERITY.citation, location: loc, original: op.a.text, edited: op.b.text, detail: `Citation removed from this text: ${named(x.c, x.e)}` });
    } else if (gained.length) {
      push({ category: 'citation', severity: SEVERITY.citation, location: loc, original: op.a.text, edited: op.b.text, detail: `Citation moved to this text: ${named(gained[0].c, gained[0].e)}` });
    }
  }
  return out;
};

/** Reference-list entries plus notes, for the File details table. */
export const referenceCount = (d: NormalizedDoc) => referenceEntries(d).filter((e) => e.group === 'list').length;
