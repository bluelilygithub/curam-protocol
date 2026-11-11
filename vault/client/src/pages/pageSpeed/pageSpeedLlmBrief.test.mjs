// node client/src/pages/pageSpeed/pageSpeedLlmBrief.test.mjs   (the Page speed "Copy for AI" prompt). No network.
import assert from 'assert';
import { buildLlmBrief, LLM_INSTRUCTION } from './pageSpeedLlmBrief.mjs';

// The instruction itself: it must tell the model what to consider, not just dump data.
for (const phrase of [
  'Things to consider',
  'Real users before lab scores',
  'Do not just restate Lighthouse',
  'Accessibility is not a score chase',
  'Do not invent file names',
  'A prioritised table',
  'A phased plan',
]) {
  assert.ok(LLM_INSTRUCTION.includes(phrase), `instruction mentions "${phrase}"`);
}

assert.strictEqual(buildLlmBrief(null), LLM_INSTRUCTION, 'no view -> instruction only');

const view = {
  strategy: 'mobile',
  finalUrl: 'https://example.com/',
  fetchTime: '2026-11-12T01:02:03Z',
  lighthouseVersion: '12.6.0',
  categories: { performance: 42, accessibility: 88, bestPractices: 75, seo: 92 },
  summary: 'mobile · Perf 42 · A11y 88 · BP 75 · SEO 92',
  metrics: [
    { id: 'first-contentful-paint', title: 'First Contentful Paint', displayValue: '2.1 s', numericValue: 2100 },
    { id: 'cumulative-layout-shift', title: 'Cumulative Layout Shift', displayValue: '0.01', numericValue: 0.01 },
  ],
  fieldData: [
    { id: 'LARGEST_CONTENTFUL_PAINT_MS', category: 'SLOW', percentile: 4200 },
    { id: 'UNKNOWN_METRIC', category: 'AVERAGE', percentile: 100 },
  ],
  workOrder: [
    { priority: 'P0', category: 'performance', categoryLabel: 'Performance', title: 'Serve one host', action: 'Drop the redirect.', evidence: ['redirect 1'] },
    { priority: 'P2', category: 'seo', categoryLabel: 'SEO', title: 'Add a description', action: 'Write one.', evidence: [] },
  ],
  opportunities: [{
    id: 'uses-text-compression', title: 'Enable text compression', description: 'Compress text.',
    docsUrl: 'https://developer.chrome.com/docs', savingsMs: 300,
    items: Array.from({ length: 12 }, (_, i) => ({ url: `https://x/${i}.js`, wastedBytes: 1000 })),
  }],
  diagnostics: [],
  failedAudits: [{ id: 'image-alt', title: 'Image elements do not have alt', items: [{ selector: 'img.hero' }] }],
  warnings: [],
};

const out = buildLlmBrief(view);

// The instruction and the evidence are both there.
assert.ok(out.startsWith(LLM_INSTRUCTION), 'instruction comes first');
assert.ok(out.includes('# The PageSpeed Insights result'), 'evidence heading');
assert.ok(out.includes('- URL: https://example.com/'), 'url');
assert.ok(out.includes('- Device: Mobile'), 'device');
assert.ok(out.includes('Performance 42 / Accessibility 88 / Best practices 75 / SEO 92'), 'scores');
assert.ok(out.includes('First Contentful Paint: 2.1 s (2100 ms)'), 'lab metric with ms');
assert.ok(out.includes('Cumulative Layout Shift: 0.01 -'), 'layout shift is unitless');
assert.ok(!out.includes('0.01 (0 ms)'), 'no bogus ms on layout shift');
assert.ok(out.includes('Largest Contentful Paint: SLOW 4200'), 'field data');
assert.ok(out.includes('unknown metric: AVERAGE 100'), 'unknown field metric is readable');

// Work order and raw finding lists.
assert.ok(out.includes('### P0 - Fix first (1)'), 'P0 group');
assert.ok(out.includes('**Serve one host** - Performance'), 'ticket title and category');
assert.ok(out.includes('What to do: Drop the redirect.'), 'ticket action');
assert.ok(out.includes('### P2 - When there is time (1)'), 'P2 group');
assert.ok(out.includes('### Enable text compression (300 ms)'), 'opportunity saving');
assert.ok(out.includes('... and 2 more'), 'items are capped');
assert.ok(out.includes('## Diagnostics\n- None'), 'empty section says None');
assert.ok(out.includes('Image elements do not have alt'), 'failed check');
assert.ok(!/undefined|null/.test(out), 'no undefined/null leaks');

const noField = buildLlmBrief({ ...view, fieldData: [] });
assert.ok(noField.includes('No field data'), 'explains missing field data');

const desktop = buildLlmBrief({ ...view, strategy: 'desktop' });
assert.ok(desktop.includes('- Device: Desktop'), 'desktop label');

console.log('pageSpeedLlmBrief tests passed');
