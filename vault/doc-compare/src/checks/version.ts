import type { NewChange } from '../compare/content';
import type { PostCheck } from '../compare/postChecks';
import type { Block, NormalizedDoc } from '../readers/types';
import { SEVERITY } from '../report/severity';

/**
 * Version number (addendum §7.10): "Version 1.3", "v1.3", "Rev B", "Draft 4" near the start, or a version history table.
 *   amber  the content changed but the version did not; or the version changed while the content barely did; or it disappeared
 *   red    the version went backwards
 *   amber  a version history table did not gain a row although the content changed
 */
export interface VersionId { label: string; parts: number[]; block: Block }

const PATTERNS = [
  /\b(?:version|ver\.)\s*(\d+(?:\.\d+){0,3})\b/i,
  /\bv(\d+(?:\.\d+){1,3})\b/i,
  /\brev(?:ision)?\.?\s+([A-Z]|\d+(?:\.\d+)*)\b/i,
  /\bdraft\s+(\d+(?:\.\d+)*)\b/i,
];
const parts = (v: string) => (/^[A-Z]$/i.test(v) ? [v.toUpperCase().charCodeAt(0) - 64] : v.split('.').map(Number));

/** The first version identifier in the first 40 blocks (or the first two pages of a PDF). */
export function findVersion(d: NormalizedDoc): VersionId | undefined {
  for (const b of d.blocks.slice(0, 40)) {
    if ((b.location.page ?? 1) > 2 || b.location.table) continue;
    for (const re of PATTERNS) { const m = re.exec(b.text); if (m) return { label: m[0], parts: parts(m[1]), block: b }; }
  }
  return undefined;
}

const cmp = (x: number[], y: number[]) => { for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d; } return 0; };

/** Rows of a version-history table (its first row mentions version or revision), or undefined. */
function historyRows(d: NormalizedDoc): number | undefined {
  const tables = new Map<number, { header: string; rows: number }>();
  for (const b of d.blocks) {
    const t = b.location.table; if (!t) continue;
    const e = tables.get(t.t) ?? { header: '', rows: 0 };
    if (t.r === 0) e.header += ` ${b.text}`;
    e.rows = Math.max(e.rows, t.r + 1);
    tables.set(t.t, e);
  }
  for (const e of tables.values()) if (/\b(version|revision|rev)\b/i.test(e.header)) return e.rows;
  return undefined;
}

export const versionNumber: PostCheck = (a, b, _ops, ctx) => {
  const va = findVersion(a), vb = findVersion(b);
  const out: NewChange[] = [];
  // content changes that matter, other than the version line itself
  const changed = ctx.changes.filter((c) => !c.trivial && c.severity !== 'low' && c.category !== 'metadata' && !(va && (c.original ?? '').includes(va.label))).length > 0;
  const where = 'Version number';
  if (va && vb) {
    const d = cmp(vb.parts, va.parts);
    if (d < 0) out.push({ category: 'versionNumber', severity: SEVERITY.versionBackwards, location: where, original: va.label, edited: vb.label, detail: `The version went backwards: ${va.label} → ${vb.label}` });
    else if (d === 0 && changed) out.push({ category: 'versionNumber', severity: SEVERITY.versionWarning, location: where, original: va.label, edited: vb.label, detail: `The content changed but the version is still ${vb.label}` });
    else if (d > 0 && !changed) out.push({ category: 'versionNumber', severity: SEVERITY.versionWarning, location: where, original: va.label, edited: vb.label, detail: `The version changed (${va.label} → ${vb.label}) but the content barely did` });
  } else if (va && !vb) {
    out.push({ category: 'versionNumber', severity: SEVERITY.versionWarning, location: where, original: va.label, detail: `The version identifier "${va.label}" is no longer in the document` });
  }
  const ha = historyRows(a), hb = historyRows(b);
  if (ha !== undefined && hb !== undefined && changed && hb <= ha) {
    out.push({ category: 'versionNumber', severity: SEVERITY.versionWarning, location: 'Version history table', original: String(ha), edited: String(hb), detail: 'The version history table did not gain a row, although the content changed' });
  }
  return out;
};
