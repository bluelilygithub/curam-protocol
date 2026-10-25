#!/usr/bin/env node
/**
 * Topic Research (milestone 4): the brief as a Markdown file. Pure code.
 *
 * Run: node server/services/topicResearch/brief/markdown.test.js
 */
'use strict';

const assert = require('assert');
const { briefToMarkdown, briefFileName } = require('./markdown');

const SOURCES = [
  { url: 'https://abc.net.au/a', title: 'Flood warnings as Queensland braces', domain: 'abc.net.au' },
  { url: 'https://theguardian.com/b', title: 'Unusually large storm', domain: 'theguardian.com' },
  { url: 'https://smh.com.au/c', title: '', domain: 'smh.com.au' },
];
const BRIEF = {
  summary: 'A storm is bringing floods to Queensland.',
  keyFacts: [
    { fact: 'A major flood warning is in force for the Mary River.', sources: ['https://abc.net.au/a', 'https://theguardian.com/b'], outletCount: 2, singleSource: false },
    { fact: 'The storm is unusually large.', sources: ['https://theguardian.com/b'], outletCount: 1, singleSource: true },
    { fact: 'A source that is not in the list.', sources: ['https://elsewhere.example/x'], outletCount: 1, singleSource: true },
  ],
  anglesTaken: [{ outlet: 'ABC', framing: 'Local impact.' }],
  gaps: ['How do renters get help?'],
  suggestedAngles: [{ title: 'Renters\' guide', why: 'Your readers rent.' }, { title: 'Insurance', why: '' }],
  chosenAngle: 'Renters\' guide',
  outline: [{ level: 2, heading: 'Who is affected', notes: ['Gympie region', 'Tiaro'] }, { level: 3, heading: 'Renters', notes: [] }],
  keywords: { primary: 'queensland flood help', related: ['mary river flood', 'storm insurance'] },
};
const META = { keyword: 'queensland storm', createdAt: '2026-10-26T03:00:00.000Z', overlap: [], sources: SOURCES };

// ------------------------------------------------------------ the file
{
  const md = briefToMarkdown(BRIEF, META);
  assert.ok(md.startsWith('# Research brief: queensland storm\n'));
  assert.ok(md.includes('_Made 2026-10-26. Notes for writing your own piece. Not text to publish._'));
  const order = ['## Summary', '## Key facts', '## Angles taken', '## Gaps', '## Suggested angles for your site', '## Outline: Renters\' guide', '## Keywords', '## Sources'].map((h) => md.indexOf(h));
  assert.ok(order.every((n) => n > 0) && order.every((n, i) => i === 0 || n > order[i - 1]), 'every section, in reading order');
  assert.ok(md.includes('- A major flood warning is in force for the Mary River. _(2 outlets)_ [1][2]'));
  assert.ok(md.includes('- The storm is unusually large. _(single source)_ [2]'));
  assert.ok(md.includes('- A source that is not in the list. _(single source)_\n') || md.includes('- A source that is not in the list. _(single source)_'), 'an address with no citation number gets none');
  assert.ok(!/\[undefined\]|\[null\]|\[\]/.test(md));
  assert.ok(md.includes('- **ABC:** Local impact.'));
  assert.ok(md.includes('1. **Renters\' guide**: Your readers rent.') && md.includes('2. **Insurance**\n'), 'a reason is optional');
  assert.ok(md.includes('### Who is affected\n- Gympie region\n- Tiaro') && md.includes('#### Renters'), 'H2 and H3 become nested headings with their notes');
  assert.ok(md.includes('- Primary: queensland flood help') && md.includes('- Related: mary river flood, storm insurance'));
  assert.ok(md.includes('1. Flood warnings as Queensland braces (abc.net.au) https://abc.net.au/a'));
  assert.ok(md.includes('3. https://smh.com.au/c (smh.com.au)') || md.includes('3. https://smh.com.au/c'), 'a source with no title shows its address');
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
  assert.ok(!/<[a-z]/i.test(md), 'no HTML');
  assert.ok(!md.includes('Check before you use this'), 'no warning when nothing overlaps');
}

// ------------------------------------------------------------ the warning comes first and travels with the file
{
  const overlap = [{ field: 'fact 1', words: 17, excerpt: 'major flood warning for the mary river as south east', sourceUrl: 'https://abc.net.au/a', sourceTitle: 'Flood warnings as Queensland braces' }];
  const md = briefToMarkdown(BRIEF, { ...META, overlap });
  assert.ok(md.indexOf('Check before you use this') > 0 && md.indexOf('Check before you use this') < md.indexOf('## Summary'));
  assert.ok(md.includes('> - fact 1: "major flood warning for the mary river as south east…" (17 words match source: Flood warnings as Queensland braces)'));
}

// ------------------------------------------------------------ the quiet cases
{
  const bare = briefToMarkdown({ ...BRIEF, anglesTaken: [], gaps: [], keywords: { primary: 'k', related: [] } }, { keyword: 'x', createdAt: null, overlap: [], sources: [] });
  assert.ok(!bare.includes('## Angles taken') && !bare.includes('## Gaps') && !bare.includes('- Related:') && !bare.includes('## Sources'));
  assert.ok(!bare.includes('Made '), 'no date, no "Made"');
  assert.ok(bare.includes('- A major flood warning is in force for the Mary River. _(2 outlets)_'), 'with no sources listed there is nothing to cite');
  assert.doesNotThrow(() => briefToMarkdown(BRIEF));
}

// ------------------------------------------------------------ file names
{
  assert.strictEqual(briefFileName('Heat pumps Queensland', '2026-10-26T03:00:00Z'), 'research-brief-heat-pumps-queensland-2026-10-26.md');
  assert.strictEqual(briefFileName('  What\'s new?! (2026)  ', '2026-01-02T00:00:00Z'), 'research-brief-what-s-new-2026-2026-01-02.md');
  assert.strictEqual(briefFileName('', null), 'research-brief-topic.md');
  assert.strictEqual(briefFileName('***', 'garbage'), 'research-brief-topic.md');
  assert.strictEqual(briefFileName('café crème', '2026-10-26T03:00:00Z'), 'research-brief-café-crème-2026-10-26.md', 'letters of any language stay');
  const long = briefFileName('a'.repeat(200), '2026-10-26T03:00:00Z');
  assert.ok(long.length <= 'research-brief-'.length + 60 + '-2026-10-26.md'.length);
  assert.ok(!/[\\/:*?"<>|]/.test(briefFileName('a/b\\c:d*e?f"g<h>i|j', '2026-10-26T03:00:00Z')), 'nothing a file system dislikes');
}

console.log('topicResearch brief markdown: all passed');
