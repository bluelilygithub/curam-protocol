// A line-by-line comparison of two texts, for showing what changed between an earlier version and the note now (and, later, what an AI change would
// do). Pure, so it is unit-tested: node client/src/pages/notes/noteDiff.test.mjs
//
// `diffLines(before, after)` returns a list of { type: 'same' | 'del' | 'add', text }: lines only in `before` are 'del', only in `after` are 'add'.
// It uses the longest common subsequence of whole lines. Two very long texts (more than MAX_CELLS comparisons) are shown as "all removed, all added"
// rather than making the screen wait.

const MAX_CELLS = 4_000_000;

export function diffLines(before, after) {
  const a = String(before ?? '').replace(/\r/g, '').split('\n');
  const b = String(after ?? '').replace(/\r/g, '').split('\n');
  // trim the lines both texts share at the start and the end: most edits touch one place
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const head = a.slice(0, start).map((text) => ({ type: 'same', text }));
  const tail = a.slice(endA).map((text) => ({ type: 'same', text }));
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (!x.length && !y.length) return [...head, ...tail];
  if (x.length * y.length > MAX_CELLS) return [...head, ...x.map((text) => ({ type: 'del', text })), ...y.map((text) => ({ type: 'add', text })), ...tail];

  // longest common subsequence table, then walk it
  const w = y.length + 1;
  const t = new Uint32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      t[i * w + j] = x[i] === y[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  const mid = [];
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) { mid.push({ type: 'same', text: x[i] }); i++; j++; }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) { mid.push({ type: 'del', text: x[i] }); i++; }
    else { mid.push({ type: 'add', text: y[j] }); j++; }
  }
  while (i < x.length) mid.push({ type: 'del', text: x[i++] });
  while (j < y.length) mid.push({ type: 'add', text: y[j++] });
  return [...head, ...mid, ...tail];
}

/** How many lines were added and removed. */
export function diffStats(ops) {
  let added = 0;
  let removed = 0;
  for (const o of ops) { if (o.type === 'add') added++; else if (o.type === 'del') removed++; }
  return { added, removed };
}

/**
 * Only the changed lines with `context` unchanged lines around them; a run of skipped lines becomes one { type: 'gap', count } entry.
 * Blank-only unchanged stretches are kept short the same way.
 */
export function collapse(ops, context = 2) {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, idx) => {
    if (o.type === 'same') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });
  const out = [];
  let skipped = 0;
  ops.forEach((o, idx) => {
    if (keep[idx]) {
      if (skipped) { out.push({ type: 'gap', count: skipped }); skipped = 0; }
      out.push(o);
    } else skipped++;
  });
  if (skipped) out.push({ type: 'gap', count: skipped });
  return out;
}
