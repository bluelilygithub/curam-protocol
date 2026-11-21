import { describe, expect, it } from 'vitest';
import { compareDocs } from '../src/compare/pipeline';
import { acceptedState, applyEdits } from '../src/project/accepted';
import { addRound, compact, createProject, decide, deleteRounds, exportDue, latest, makeNewOriginal, storeFile, timeline, type CompareFn } from '../src/project/engine';
import { projectSize, type Project } from '../src/project/model';
import { exportProject, importProject } from '../src/project/transfer';
import { itemIdOf, summaryLine } from '../src/project/track';
import { markdownReader } from '../src/readers/markdown';
import { DEFAULT_SETTINGS } from '../src/settings';

const compare: CompareFn = async (a, b) => compareDocs(a, b, DEFAULT_SETTINGS);

const A = 'Rents in Sydney rose by 14% in the twelve months to June, the fastest rise in more than a decade for private renters.';
const B = 'These figures cover the private rental market only and do not include social housing, which is measured in a different way.';
const C = 'Around half of the households we assisted were paying more than half of their income in rent, well above the usual measure.';
const D = 'Our caseworkers recorded 318 notices to vacate this year, and most of them were issued without any reason being given.';
const E = 'Families who are forced to move often lose contact with schools, doctors and the support networks they rely on every week.';
// Background holds A, B and C (those given); Evidence holds D and E, so a removed paragraph never moves another between sections
const md = (...paras: string[]) => {
  const ev = paras.filter((x) => x.startsWith('Our caseworkers') || x.startsWith('Families'));
  return `# Housing submission\n\n## Background\n\n${paras.filter((x) => !ev.includes(x)).join('\n\n')}\n\n## Evidence\n\n${ev.join('\n\n')}\n`;
};
let n = 0;
async function file(text: string) {
  const f = new File([text], `draft${n++}.md`, { lastModified: Date.UTC(2026, 0, 1) });
  return storeFile(f, await markdownReader.read(f));
}
const item = (p: Project, round: number, pred: (c: { category: string; original?: string; edited?: string }) => boolean) => p.rounds.find((r) => r.number === round)!.items.find((i) => pred(i.change))!;

async function start() {
  let p = createProject(await file(md(A, B, C, D)), 'Housing submission');
  // round 1: the caveat is dropped and a figure changed
  p = (await addRound(p, await file(md(A, C, D.replace('318', '381'))), compare, 'First LLM pass', '2026-11-01T00:00:00.000Z')).project;
  return p;
}

describe('projects: rounds and the three-way review', () => {
  it('round 1 is checked against the original', async () => {
    const p = await start();
    const r = latest(p)!;
    expect(r.verdict).toBe('red');
    expect(r.items.map((i) => [i.change.category, i.status])).toEqual(expect.arrayContaining([['removed', 'open'], ['number', 'open']]));
    expect(r.note).toBe('First LLM pass');
  });

  it('round 2: an accepted change is not asked again, a restore that did not happen is red, and new content is new', async () => {
    let p = await start();
    p = await decide(p, 1, item(p, 1, (c) => c.category === 'removed').itemId, 'restore', compare);
    p = await decide(p, 1, item(p, 1, (c) => c.category === 'number').itemId, 'accept', compare);
    // the accepted state now has 381, and still has the caveat
    expect(acceptedState(p).blocks.map((b) => b.text)).toEqual(expect.arrayContaining([B, D.replace('318', '381')]));
    p = (await addRound(p, await file(md(A, C, D.replace('318', '381'), E)), compare)).project;
    const r = latest(p)!;
    const removed = item(p, 2, (c) => c.category === 'removed');
    expect(removed).toMatchObject({ status: 'notFixed', firstRound: 1 });
    expect(removed.change.roundNote).toBe("You chose to restore this in round 1, but it's still missing.");
    expect(item(p, 2, (c) => c.category === 'number')).toMatchObject({ status: 'accepted', decidedInRound: 1 });
    expect(item(p, 2, (c) => c.category === 'added')).toMatchObject({ status: 'new' });
    // round 1's whole-document word drop is gone now that a paragraph was added
    expect(r.items.filter((i) => i.status === 'fixed').map((i) => i.change.detail)).toEqual([expect.stringMatching(/^Word count dropped/)]);
    expect(r.summary).toEqual({ fixed: 1, notFixed: 1, new: 1 });
    expect(summaryLine(2, r.summary)).toBe('Round 2: 1 issue fixed, 1 not fixed, 1 new change.');
    // the queue starts with what was not fixed, then what is new
    const queue = r.vsAccepted.changes.filter((c) => c.roundNote);
    expect(queue[0].roundNote).toMatch(/still missing/);
    expect(r.vsPrevious?.changes.some((c) => c.category === 'added')).toBe(true);
  });

  it('round 3: a restored paragraph is fixed, an untouched open item is drift', async () => {
    let p = await start();
    p = (await addRound(p, await file(md(A, C, D.replace('318', '381'), E)), compare)).project;
    p = (await addRound(p, await file(md(A, B, C, D.replace('318', '381'), E)), compare)).project;
    expect(item(p, 3, (c) => c.category === 'removed')).toMatchObject({ status: 'fixed', fixedInRound: 3 });
    const added = item(p, 3, (c) => c.category === 'added');
    expect(added).toMatchObject({ status: 'open', firstRound: 2 });
    expect(added.change.roundNote).toBe('Changed in round 2 and still not decided.');
    expect(latest(p)!.summary.fixed).toBe(1);
  });

  it('a paragraph removed in round 1 and never restored is drift with the plain message', async () => {
    let p = await start();
    p = (await addRound(p, await file(md(A, C, D.replace('318', '381'), E)), compare)).project;
    expect(item(p, 2, (c) => c.category === 'removed').change.roundNote).toBe("This paragraph from your original was removed in round 1 and hasn't come back.");
  });

  it('the same item keeps its identity although paragraph numbers moved', async () => {
    const p = await start();
    const p2 = (await addRound(p, await file(md(E, A, C, D.replace('318', '381'))), compare)).project;
    expect(itemIdOf(item(p2, 2, (c) => c.category === 'removed').change)).toBe(itemIdOf(item(p, 1, (c) => c.category === 'removed').change));
  });

  it('a file already in the project is not added again', async () => {
    const p = await start();
    const again = await addRound(p, { ...latest(p)!.file }, compare);
    expect(again.duplicateOf).toBe(1);
    expect((await addRound(p, { ...p.original }, compare)).duplicateOf).toBe('original');
  });

  it('undoing an acceptance in an earlier round checks the latest round again', async () => {
    let p = await start();
    const num = item(p, 1, (c) => c.category === 'number').itemId;
    p = await decide(p, 1, num, 'accept', compare);
    p = (await addRound(p, await file(md(A, C, D.replace('318', '381'), E)), compare)).project;
    expect(latest(p)!.vsAccepted.changes.some((c) => c.category === 'number')).toBe(false);
    // only an acceptance can be undone in an earlier round
    expect(await decide(p, 1, num, 'later', compare)).toBe(p);
    p = await decide(p, 1, num, null, compare);
    expect(latest(p)!.vsAccepted.changes.some((c) => c.category === 'number')).toBe(true);
    expect(item(p, 2, (c) => c.category === 'number').status).not.toBe('accepted');
  });

  it('an accepted paragraph with an open invented claim in it stays out of the accepted state', async () => {
    let p = createProject(await file(md(A, B, C, D)));
    p = (await addRound(p, await file(md(A, B, C, D, `${E} A 2024 survey found that 67% of renters had moved twice.`)), compare)).project;
    const added = item(p, 1, (c) => c.category === 'added');
    expect(item(p, 1, (c) => c.category === 'newClaim')).toBeTruthy();
    p = await decide(p, 1, added.itemId, 'accept', compare);
    expect(acceptedState(p).blocks.some((b) => b.text.startsWith('Families'))).toBe(false);
    for (const c of latest(p)!.items.filter((i) => i.change.category === 'newClaim')) p = await decide(p, 1, c.itemId, 'accept', compare);
    expect(acceptedState(p).blocks.some((b) => b.text.startsWith('Families'))).toBe(true);
  });
});

describe('projects: original, storage, timeline, export', () => {
  it('the new original needs a reason, records what it absorbed, and later rounds use it', async () => {
    let p = await start();
    expect(() => makeNewOriginal(p, '  ')).toThrow(/reason/);
    p = makeNewOriginal(p, 'Restructured after the committee hearing');
    expect(p.originalHistory[0]).toMatchObject({ replacedByRound: 1, reason: 'Restructured after the committee hearing', absorbed: 3 });
    expect(latest(p)!.verdict).toBe('green');
    p = (await addRound(p, await file(md(A, C, D.replace('318', '381'), E)), compare)).project;
    expect(latest(p)!.items.map((i) => [i.change.category, i.status])).toEqual([['added', 'new']]);
    expect(timeline(p)[0].replacedOriginal).toMatchObject({ absorbed: 3 });
  });

  it('compacting keeps the originals and the last two rounds; deleting a round takes the later ones with it', async () => {
    let p = await start();
    p = (await addRound(p, await file(md(A, C, D, E)), compare)).project;
    p = (await addRound(p, await file(md(A, B, C, D, E)), compare)).project;
    const { project, freed } = compact(p);
    expect(project.rounds.map((r) => !!r.file.bytes)).toEqual([false, true, true]);
    expect(project.original.bytes).toBeTruthy();
    expect(freed).toBeGreaterThan(0);
    expect(project.rounds[0].items.length).toBe(p.rounds[0].items.length);
    expect(deleteRounds(p, 2).rounds.map((r) => r.number)).toEqual([1]);
    expect(projectSize(p)).toBeGreaterThan(projectSize(project));
  });

  it('the timeline marks the round that lost the most words', async () => {
    let p = await start();
    p = (await addRound(p, await file(md(A, B, C, D, E)), compare)).project;
    const t = timeline(p);
    expect(t.map((r) => r.largestLoss)).toEqual([true, false]);
    expect(t[0].wordsLost).toBeGreaterThan(0);
  });

  it('reminds to export at the start and every 5 rounds without one', async () => {
    const p = await start();
    expect(exportDue(p)).toBe(true);
    expect(exportDue({ ...p, exportedAt: 'x', exportedAtRound: 1 })).toBe(false);
    expect(exportDue({ ...p, rounds: Array(6).fill(p.rounds[0]), exportedAt: 'x', exportedAtRound: 1 })).toBe(true);
  });

  it('exports to one .doccompare file and imports it back', async () => {
    let p = await start();
    p = await decide(p, 1, item(p, 1, (c) => c.category === 'removed').itemId, 'later', compare);
    const blob = await exportProject(p);
    const back = await importProject(blob);
    expect(back.id).toBe(p.id);
    expect(back.rounds[0].items.find((i) => i.change.category === 'removed')?.decision).toBe('later');
    expect(back.original.doc.metadata.lastModified).toBeInstanceOf(Date);
    expect(await back.original.bytes!.text()).toBe(await p.original.bytes!.text());
    expect(back.exportedAtRound).toBe(1);
    await expect(importProject(new Blob(['not a zip']))).rejects.toThrow(/not a DocCompare project/);
  });

  it('applying edits never loses accepted text when its anchor has gone', () => {
    const doc = { kind: 'document' as const, sourceType: 'md', metadata: { fileName: 'x', fileSizeBytes: 1, lastModified: new Date(0), wordCount: 0, charCount: 0, headingCount: 0, tableCount: 0, imageCount: 0 }, blocks: ['one', 'two'].map((t, i) => ({ id: `b${i}`, type: 'paragraph' as const, text: t, runs: [], location: { index: i } })) };
    const out = applyEdits(doc, [{ remove: ['b0'] }, { insert: { after: 'b0', blocks: [{ id: 'x#0', type: 'paragraph', text: 'three', runs: [], location: { index: 0 } }] } }]);
    expect(out.blocks.map((b) => b.text)).toEqual(['two', 'three']);
    expect(out.metadata.wordCount).toBe(2);
  });
});
