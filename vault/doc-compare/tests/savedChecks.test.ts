import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/review/decisions';
import { checkSize, defaultLabel, memoryChecks, searchChecks, toFile, upsertCheck } from '../src/review/savedChecks';

const f = (name: string, text: string) => new File([text], name, { type: 'text/markdown', lastModified: Date.UTC(2026, 10, 1) });
const T1 = new Date('2026-11-21T01:00:00Z'), T2 = new Date('2026-11-21T02:00:00Z');

describe('saved checks', () => {
  it('a comparison is saved with its label, or the edited file name and date when none was typed', async () => {
    const s = memoryChecks();
    const a = await upsertCheck(s, { pairKey: 'pair:1:2', label: 'Housing submission draft 3', original: f('orig.md', 'a'), edited: f('edited.md', 'b') }, T1);
    expect(a.label).toBe('Housing submission draft 3');
    const b = await upsertCheck(s, { pairKey: 'pair:3:4', label: '  ', original: f('orig.md', 'a'), edited: f('Senate_submission-v2.docx', 'c') }, T1);
    expect(b.label).toBe(defaultLabel('Senate_submission-v2.docx', T1));
    expect(b.label).toMatch(/^Senate submission v2 · /);
    expect(await s.list()).toHaveLength(2);
  });

  it('comparing the same two files again updates the saved check instead of adding a copy', async () => {
    const s = memoryChecks();
    const first = await upsertCheck(s, { pairKey: 'pair:1:2', label: 'First name', original: f('o.md', 'a'), edited: f('e.md', 'b') }, T1);
    const again = await upsertCheck(s, { pairKey: 'pair:1:2', label: '', original: f('o.md', 'a'), edited: f('e.md', 'b') }, T2);
    expect(again.id).toBe(first.id);
    expect(again.label).toBe('First name'); // an empty label keeps the old one
    expect(again.updatedAt).toBe(T2.toISOString());
    expect(await s.list()).toHaveLength(1);
    const renamed = await upsertCheck(s, { pairKey: 'pair:1:2', label: 'New name', original: f('o.md', 'a'), edited: f('e.md', 'b') }, T2);
    expect(renamed.label).toBe('New name');
  });

  it('keeps both files so they can be opened again', async () => {
    const s = memoryChecks();
    const c = await upsertCheck(s, { pairKey: 'p', label: 'x', original: f('o.md', '# Original'), edited: f('e.md', '# Edited!') }, T1);
    const back = toFile((await s.get(c.id))!.edited);
    expect(back.name).toBe('e.md');
    expect(await back.text()).toBe('# Edited!');
    expect(checkSize(c)).toBe(19);
  });

  it('search matches label and file names, every word, any case; newest first', async () => {
    const s = memoryChecks();
    await upsertCheck(s, { pairKey: 'a', label: 'Housing inquiry submission', original: f('housing.docx', 'a'), edited: f('housing-ai.docx', 'b') }, T1);
    await upsertCheck(s, { pairKey: 'b', label: 'Grant application', original: f('grant.docx', 'a'), edited: f('grant-final.docx', 'b') }, T2);
    const list = await s.list();
    expect(searchChecks(list, '').map((c) => c.label)).toEqual(['Grant application', 'Housing inquiry submission']);
    expect(searchChecks(list, 'HOUSING submission').map((c) => c.label)).toEqual(['Housing inquiry submission']);
    expect(searchChecks(list, 'final').map((c) => c.label)).toEqual(['Grant application']); // file name
    expect(searchChecks(list, 'housing grant')).toEqual([]);
  });

  it('deleting removes the check and its decisions', async () => {
    const s = memoryChecks(), d = memoryStore();
    const c = await upsertCheck(s, { pairKey: 'pair:x:y', label: 'x', original: f('o.md', 'a'), edited: f('e.md', 'b') }, T1);
    await d.save('pair:x:y', { k: { decision: 'accept', decidedAt: T1.toISOString() } });
    await s.remove(c.id); await d.remove(c.pairKey);
    expect(await s.list()).toEqual([]);
    expect(await d.load('pair:x:y')).toEqual({});
  });
});
