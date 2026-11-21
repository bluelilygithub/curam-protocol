import type { DocMetadata } from '../readers/types';
import type { Change, MetaRow } from '../report/model';
import { SEVERITY } from '../report/severity';
import type { Settings } from '../settings';

type NewChange = Omit<Change, 'id'>;

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const fmtDate = (d?: Date) => (d && !isNaN(+d) ? d.toLocaleString() : '—');
const pct = (a: number, b: number) => (a ? ((b - a) / a) * 100 : b ? Infinity : 0);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Metadata table plus the changes it flags. Fields a reader couldn't supply (undefined) are shown as — and never flagged. */
export function compareMetadata(a: DocMetadata, b: DocMetadata, s: Settings): { rows: MetaRow[]; changes: NewChange[] } {
  const rows: MetaRow[] = [];
  const changes: NewChange[] = [];
  const flag = (severity: Change['severity'], detail: string, original: string, edited: string) =>
    changes.push({ category: 'metadata', severity, location: 'File metadata', detail, original, edited });

  // sizes
  const sizePct = pct(a.fileSizeBytes, b.fileSizeBytes);
  const sizeFlag = Math.abs(sizePct) > s.fileSizeChangePct;
  rows.push({ label: 'File size', original: fmtBytes(a.fileSizeBytes), edited: fmtBytes(b.fileSizeBytes), difference: `${signed(b.fileSizeBytes - a.fileSizeBytes)} B (${sizePct > 0 ? '+' : ''}${sizePct.toFixed(1)}%)`, flagged: sizeFlag });
  if (sizeFlag) flag(SEVERITY.metadataWarning, `File size changed by ${sizePct.toFixed(1)}%${sizePct < 0 ? ' — a much smaller file often means skipped content' : ''}`, fmtBytes(a.fileSizeBytes), fmtBytes(b.fileSizeBytes));
  rows.push({ label: 'File name', original: a.fileName, edited: b.fileName, difference: a.fileName === b.fileName ? '—' : 'different' });
  rows.push({ label: 'Last modified (file)', original: fmtDate(a.lastModified), edited: fmtDate(b.lastModified), difference: '—' });

  // internal dates
  // whole seconds: Office stores seconds, and sub-second noise from generators shouldn't flag
  const sec = (d: Date) => Math.floor(+d / 1000);
  const created = a.created && b.created && sec(a.created) !== sec(b.created);
  rows.push({ label: 'Created', original: fmtDate(a.created), edited: fmtDate(b.created), difference: !a.created || !b.created ? '—' : created ? 'different' : 'same', flagged: !!created });
  if (created) flag(SEVERITY.metadataWarning, "Edited file's internal created date differs from the original's — it may be a new document rather than an edit", fmtDate(a.created), fmtDate(b.created));
  const earlier = a.modified && b.modified && sec(b.modified) < sec(a.modified);
  rows.push({ label: 'Modified', original: fmtDate(a.modified), edited: fmtDate(b.modified), difference: !a.modified || !b.modified ? '—' : earlier ? 'edited is earlier' : sec(a.modified) === sec(b.modified) ? 'same' : 'later', flagged: !!earlier });
  if (earlier) flag(SEVERITY.metadataWarning, "Edited file's modified date is earlier than the original's", fmtDate(a.modified), fmtDate(b.modified));

  // informational strings
  const strings: [string, keyof DocMetadata][] = [['Author', 'author'], ['Last modified by', 'lastModifiedBy'], ['Revision', 'revision'], ['Title', 'title'], ['Producer', 'producer'], ['Application', 'application']];
  for (const [label, k] of strings) {
    const va = a[k] as string | undefined, vb = b[k] as string | undefined;
    if (va === undefined && vb === undefined) continue;
    const changed = va !== undefined && vb !== undefined && va !== vb;
    rows.push({ label, original: va ?? '—', edited: vb ?? '—', difference: changed ? 'changed' : '—' });
    if (changed && (k === 'author' || k === 'producer' || k === 'application')) flag(SEVERITY.metadataInfo, `${label} changed`, va, vb);
  }

  // counts
  const wordPct = pct(a.wordCount, b.wordCount);
  const counts: [string, number | undefined, number | undefined][] = [
    ['Pages', a.pageCount, b.pageCount], ['Words', a.wordCount, b.wordCount], ['Characters', a.charCount, b.charCount],
    ['Headings', a.headingCount, b.headingCount], ['Tables', a.tableCount, b.tableCount], ['Images', a.imageCount, b.imageCount],
    // shown only when either document has some (0 and 0 is noise for a document without references)
    ...((a.referenceCount || b.referenceCount ? [['References', a.referenceCount, b.referenceCount]] : []) as [string, number | undefined, number | undefined][]),
    ...((a.noteCount || b.noteCount ? [['Footnotes and endnotes', a.noteCount, b.noteCount]] : []) as [string, number | undefined, number | undefined][]),
  ];
  for (const [label, va, vb] of counts) {
    if (va === undefined || vb === undefined) { if (va !== undefined || vb !== undefined) rows.push({ label, original: String(va ?? '—'), edited: String(vb ?? '—'), difference: '—' }); continue; }
    const d = vb - va;
    const wordDrop = label === 'Words' && -wordPct > s.wordCountDropPct;
    rows.push({ label, original: String(va), edited: String(vb), difference: d ? `${signed(d)}${va ? ` (${pct(va, vb).toFixed(1)}%)` : ''}` : '—', flagged: wordDrop || (d !== 0 && label !== 'Words' && label !== 'Characters') });
    if (wordDrop) flag(SEVERITY.wordCountDrop, `Word count dropped by ${(-wordPct).toFixed(1)}%`, String(va), String(vb));
    else if (d && label !== 'Words' && label !== 'Characters') flag(d < 0 ? SEVERITY.metadataWarning : SEVERITY.metadataInfo, `${label} count changed (${signed(d)})`, String(va), String(vb));
  }
  return { rows, changes };
}
