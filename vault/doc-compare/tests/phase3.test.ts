import { beforeAll, describe, expect, it } from 'vitest';
import { findClaims } from '../src/checks/claims';
import { findVersion } from '../src/checks/version';
import { compareDocs } from '../src/compare/pipeline';
import { readPair } from '../src/compare/read';
import { markdownReader } from '../src/readers/markdown';
import { describe as describeMsg } from '../src/report/messages';
import { summarySentence } from '../src/review/verdict';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { buildFixtures } from './fixtures/generate.mjs';

type Fixture = Awaited<ReturnType<typeof buildFixtures>>[number];
let fixtures: Fixture[] = [];
beforeAll(async () => { fixtures = await buildFixtures(); }, 60000);
const file = (f: { name: string; bytes: Uint8Array }) => new File([f.bytes.slice()], f.name);
async function result(name: string, s: Partial<Settings> = {}) {
  const f = fixtures.find((x) => x.name === name)!;
  const [a, b] = await readPair(file(f.original), file(f.edited));
  return compareDocs(a, b, { ...DEFAULT_SETTINGS, ...(f.expect.settings ?? {}), ...s });
}
const md = (text: string) => markdownReader.read(new File([text], 'x.md'));

describe('claim tokens', () => {
  it('finds statistics, citations, links and sources', () => {
    const c = findClaims('A 2021 survey by the Housing Research Centre found that 67% of renters moved, costing $3.2 million and 1,200 households since 2019 [3] (Smith et al., 2021), see https://example.org/x and doi:10.1000/182.');
    const kinds = c.map((x) => `${x.kind}: ${x.text}`);
    expect(kinds).toEqual(expect.arrayContaining([
      'statistic: 67%', 'statistic: $3.2 million', 'statistic: 1,200 households', 'statistic: since 2019',
      'citation: [3]', 'citation: (Smith et al., 2021)', 'link: https://example.org/x', 'link: doi:10.1000/182',
      'source: A 2021 survey by the Housing Research Centre'.replace('source', 'attribution'),
    ]));
  });
  it('ignores plain dates and numbers without meaning', () => {
    expect(findClaims('Rents rose in June 2023, the third time this year. See section 4.')).toEqual([]);
  });
});

describe('new claims (addendum §4)', () => {
  it('an added paragraph: one red item per invented statistic, quote, citation and source', async () => {
    const r = await result('uc04-invented-claims.docx');
    const claims = r.changes.filter((c) => c.category === 'newClaim').map((c) => c.detail);
    expect(claims.sort()).toEqual(['Citation: (Smith et al., 2021)', 'Quote: "the market simply cannot keep up with demand"', 'Source: A 2021 survey by the Housing Research Centre', 'Statistic: 67%'].sort());
    expect(r.changes.filter((c) => c.category === 'newClaim').every((c) => c.severity === 'high' && c.tier === 'red')).toBe(true);
    expect(describeMsg(r.changes.find((c) => c.detail === 'Statistic: 67%')!).summary).toBe("The LLM added a statistic that isn't in your original: 67%");
  });
  it('a statistic slipped into an existing sentence is a new claim, not a number change', async () => {
    const r = await result('uc04-statistic-inserted.md');
    expect(r.changes.filter((c) => c.category === 'newClaim').map((c) => c.detail)).toEqual(['Statistic: 85,000 households']);
    expect(r.changes.some((c) => c.category === 'number')).toBe(false);
  });
  it('a changed figure stays a number change, not a new claim', async () => {
    const r = await result('uc02-statistic-changed.md');
    expect(r.changes.filter((c) => c.category === 'newClaim')).toEqual([]);
    expect(r.changes.filter((c) => c.category === 'number')).toHaveLength(1);
  });
});

describe('quotes (addendum §5.2)', () => {
  it('one word changed in a direct quote is red, with the word diff', async () => {
    const q = (await result('uc05-quote-changed.docx')).changes.find((c) => c.category === 'quote')!;
    expect(q).toMatchObject({ severity: 'high', detail: 'Quote reworded' });
    expect(q.diffHtml).toContain('<del>every</del>');
    expect(q.diffHtml).toContain('<ins>each</ins>');
  });
  it('a quote removed from a paragraph that stays is red; a removed paragraph is not reported twice', async () => {
    const a = await md('# T\n\nThe Minister said "renters deserve a fair go every single time" in parliament.\n\nAnother paragraph that stays the same in both versions.\n');
    const b = await md('# T\n\nThe Minister spoke about renters in parliament.\n\nAnother paragraph that stays the same in both versions.\n');
    expect(compareDocs(a, b, DEFAULT_SETTINGS).changes.filter((c) => c.category === 'quote').map((c) => c.detail)).toEqual(['Quote removed']);
    const c = await md('# T\n\nAnother paragraph that stays the same in both versions.\n');
    expect(compareDocs(a, c, DEFAULT_SETTINGS).changes.filter((x) => x.category === 'quote')).toEqual([]);
  });
  it('markdown block quotes count as quotes', async () => {
    const d = await md('> We moved three times in two years.\n');
    expect(d.blocks[0].style).toBe('quote');
  });
});

describe('word and page limits (addendum §5.4)', () => {
  it('over the limit is red and says by how much; the reference list is not counted', async () => {
    const r = await result('uc06-over-word-limit.md');
    const w = r.changes.find((c) => c.category === 'wordLimit')!;
    expect(w.severity).toBe('high');
    expect(w.detail).toMatch(/^\d+ words, over the 250-word limit by \d+ \(reference list not counted\)$/);
    expect(r.words!.referencesExcluded).toBe(true);
    expect(r.words!.sections.map((s) => s.title)).not.toContain('References');
    const counted = await result('uc06-over-word-limit.md', { excludeReferences: false });
    expect(counted.words!.edited).toBeGreaterThan(r.words!.edited);
  });
  it('no limit set: no finding, but the counts are there', async () => {
    const r = await result('uc06-over-word-limit.md', { wordLimit: null });
    expect(r.changes.filter((c) => c.category === 'wordLimit')).toEqual([]);
    expect(r.words!.original).toBe(r.words!.edited);
  });
});

describe('required headings (addendum §5.6)', () => {
  it('a missing required heading is red; numbering does not matter', async () => {
    const r = await result('uc03-required-heading-missing.md');
    expect(r.changes.filter((c) => c.category === 'requiredHeading').map((c) => [c.severity, c.detail])).toEqual([['high', 'Required heading missing: "Costings"']]);
  });
  it('out of order is amber', async () => {
    const r = await result('uc03-required-heading-order.md');
    expect(r.changes.filter((c) => c.category === 'requiredHeading').map((c) => c.severity)).toEqual(['medium']);
  });
  it('no list set: nothing extra (removed headings are already reported)', async () => {
    const r = await result('uc03-heading-removed.md');
    expect(r.changes.filter((c) => c.category === 'requiredHeading')).toEqual([]);
  });
});

describe('version number (addendum §7.10)', () => {
  it('finds common forms', async () => {
    for (const [t, label] of [['Version 1.3', 'Version 1.3'], ['Report v2.1 final', 'v2.1'], ['Rev B', 'Rev B'], ['Draft 4 for comment', 'Draft 4']]) {
      expect(findVersion(await md(`# Title\n\n${t}\n`))?.label).toBe(label);
    }
  });
  it('content changed, version not: amber; version backwards: red', async () => {
    const a = (await result('uc11-version-not-updated.md')).changes.find((c) => c.category === 'versionNumber')!;
    expect(a).toMatchObject({ severity: 'medium', detail: 'The content changed but the version is still Version 1.2' });
    const b = (await result('uc11-version-backwards.md')).changes.find((c) => c.category === 'versionNumber')!;
    expect(b).toMatchObject({ severity: 'high', detail: 'The version went backwards: Version 1.2 → Version 1.1' });
  });
  it('no content change and no version change: nothing', async () => {
    expect((await result('identical.md')).changes.filter((c) => c.category === 'versionNumber')).toEqual([]);
  });
});

describe('the verdict sentence counts the new findings', () => {
  it('claims, quotes and limits are in the sentence', async () => {
    expect(summarySentence((await result('uc04-invented-claims.md')).changes)).toMatch(/added 1 passage and 4 claims that need checking/);
    expect(summarySentence((await result('uc05-quote-changed.md')).changes)).toMatch(/changed 1 quote/);
    expect(summarySentence((await result('uc06-over-word-limit.md')).changes)).toMatch(/over the word limit/);
  });
});
