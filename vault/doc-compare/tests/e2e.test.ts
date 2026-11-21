import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { compareDocs, similarity } from '../src/compare/pipeline';
import { readPair } from '../src/compare/read';
import { GateError } from '../src/readers/types';
import { DEFAULT_SETTINGS } from '../src/settings';
import { buildFixtures } from './fixtures/generate.mjs';

type Fixture = Awaited<ReturnType<typeof buildFixtures>>[number];
let fixtures: Fixture[] = [];
beforeAll(async () => { fixtures = await buildFixtures(); }, 60000);

const file = (f: { name: string; bytes: Uint8Array }) => new File([f.bytes.slice()], f.name, { lastModified: Date.UTC(2026, 0, 1) });

async function run(f: Fixture) {
  const [a, b] = await readPair(file(f.original), file(f.edited));
  // a fixture can set what a person would set first (a word limit, a list of required headings)
  return { a, b, sim: similarity(a, b), result: compareDocs(a, b, { ...DEFAULT_SETTINGS, ...(f.expect.settings ?? {}) }) };
}

// the case list lives in the generator; names are known up front so each gets its own test
const NAMES = await buildFixtures().then((list) => list.map((f) => f.name));

describe('end-to-end per fixture', () => {
  it.each(NAMES)('%s', async (name) => {
    const f = fixtures.find((x) => x.name === name)!;
    if (f.expect.gate === 'type-mismatch') {
      await expect(readPair(file(f.original), file(f.edited))).rejects.toMatchObject({ name: 'GateError', code: 'type-mismatch' });
      return;
    }
    const { sim, result } = await run(f);
    if (f.expect.gate === 'similarity') { expect(sim.score).toBeLessThan(DEFAULT_SETTINGS.similarityThreshold); return; }
    expect(sim.score).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.similarityThreshold);
    const visible = result.changes.filter((c) => c.category !== 'metadata' && !c.trivial);
    expect(visible.map((c) => `${c.category}: ${c.location} — ${c.detail ?? ''}`), JSON.stringify(visible, null, 1).slice(0, 2000)).toHaveLength(f.expect.categories.length);
    expect(visible.map((c) => c.category).sort()).toEqual([...f.expect.categories].sort());
    if (f.expect.trivial) expect(result.trivialCount).toBeGreaterThan(0);
    // red file-detail findings (whole-document or per-section word-count drops): exactly the expected ones
    const redMeta = result.changes.filter((c) => c.category === 'metadata' && c.severity === 'high').map((c) => c.detail ?? '');
    const want = f.expect.redMeta ?? [];
    expect(redMeta.filter((d) => !want.some((p) => new RegExp(p).test(d))), 'no unexpected red file-detail findings').toEqual(redMeta.filter((d) => /^Word count dropped/.test(d)));
    for (const p of want) expect(redMeta.some((d) => new RegExp(p).test(d)), `red finding ${p}`).toBe(true);
    // every change carries its plain-language message and tier (addendum §2)
    for (const c of result.changes) expect(c.summary && c.whyItMatters && c.action && c.tier, `change ${c.id} is described`).toBeTruthy();
  });
});

describe('grouping and severity', () => {
  it('a removed section is one high-severity change with the heading and its blocks as children', async () => {
    const { result } = await run(fixtures.find((x) => x.name === 'section-removed.docx')!);
    const c = result.changes.find((x) => x.category === 'removed')!;
    expect(c).toMatchObject({ severity: 'high', group: 'section' });
    expect(c.children).toHaveLength(3);
  });
  it('a removed table row is one high-severity change', async () => {
    const { result } = await run(fixtures.find((x) => x.name === 'table-row-removed.docx')!);
    expect(result.changes.find((x) => x.category === 'removed')).toMatchObject({ severity: 'high', group: 'tableRow', original: 'Build | June | Acme engineering' });
  });
  it('a number change is high severity and names the values', async () => {
    const { result } = await run(fixtures.find((x) => x.name === 'number-changed.pdf')!);
    expect(result.changes.find((x) => x.category === 'number')).toMatchObject({ severity: 'high', detail: '"30" → "60"' });
  });
  it('heading level change says which levels', async () => {
    const { result } = await run(fixtures.find((x) => x.name === 'heading-level.docx')!);
    expect(result.changes.find((x) => x.category === 'formatting')?.detail).toContain('Heading 2 → Heading 3');
  });
  it('removed paragraph shows on the metadata word count', async () => {
    const { a, b } = await run(fixtures.find((x) => x.name === 'section-removed.md')!);
    expect(b.metadata.wordCount).toBeLessThan(a.metadata.wordCount);
  });
});

describe('Gate 1', () => {
  it('rejects unsupported and legacy files', async () => {
    const doc = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3])], 'old.doc');
    await expect(readPair(doc, doc)).rejects.toMatchObject({ code: 'legacy-doc' });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0])], 'x.png');
    await expect(readPair(png, png)).rejects.toBeInstanceOf(GateError);
  });
  it('rejects a corrupt PDF with a clear message', async () => {
    const bad = new File([new TextEncoder().encode('%PDF-1.7\nnot really a pdf')], 'bad.pdf');
    await expect(readPair(bad, bad)).rejects.toMatchObject({ code: 'corrupt' });
  });
});

describe('privacy', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('makes no network calls during a comparison', async () => {
    const fetchSpy = vi.fn(() => { throw new Error('network call during comparison'); });
    const xhrSpy = vi.fn(() => { throw new Error('network call during comparison'); });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    for (const type of ['pdf', 'docx', 'md', 'txt']) await run(fixtures.find((x) => x.name === `paragraph-removed.${type}`)!);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  });
});
