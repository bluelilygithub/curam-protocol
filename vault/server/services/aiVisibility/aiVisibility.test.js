#!/usr/bin/env node
/**
 * AI Visibility: the pure parts of the audit, with no network, browser or database.
 * robots.txt grouping/matching, JSON-LD entity validation, key-fact matching, the
 * weighted score (including unmeasured areas) and the Markdown report.
 *
 * Run: node server/services/aiVisibility/aiVisibility.test.js
 */
'use strict';

const assert = require('assert');
const { parseRobots, checkBot, auditRobots, pathMatches, AI_BOTS } = require('./robots');
const { extractJsonLd, validateSchema, checkEntity } = require('./schema');
const { matchFact, factCoverage, extractNumbers } = require('./facts');
const { scoreReport, overallScore, scoreReadability } = require('./scoring');
const { buildMarkdown } = require('./markdown');

function test(name, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

// ---------------------------------------------------------------- robots.txt

test('robots: consecutive user-agent lines share one group', () => {
  const parsed = parseRobots(`
    # comment
    User-agent: GPTBot
    User-agent: ClaudeBot
    Disallow: /private
    Allow: /private/ok

    User-agent: *
    Disallow: /
  `);
  assert.strictEqual(parsed.groups.length, 2);
  assert.deepStrictEqual(parsed.groups[0].agents, ['gptbot', 'claudebot']);
  assert.deepStrictEqual(parsed.groups[0].rules, [
    { type: 'disallow', path: '/private' },
    { type: 'allow', path: '/private/ok' },
  ]);
});

test('robots: an empty Disallow means no restriction, not block everything', () => {
  const parsed = parseRobots('User-agent: *\nDisallow:\nAllow: /x');
  assert.deepStrictEqual(parsed.groups[0].rules, [{ type: 'allow', path: '/x' }]);
});

test('robots: longest matching path wins and Allow wins a tie', () => {
  const parsed = parseRobots('User-agent: GPTBot\nDisallow: /shop\nAllow: /shop/open\nDisallow: /tie\nAllow: /tie');
  assert.strictEqual(checkBot(parsed, 'GPTBot', '/shop/open/page').allowed, true, 'the longer Allow wins');
  assert.strictEqual(checkBot(parsed, 'GPTBot', '/shop/closed').allowed, false, 'the shorter Disallow still covers the rest');
  assert.strictEqual(checkBot(parsed, 'GPTBot', '/tie').allowed, true, 'equal length: Allow wins');
});

test('robots: wildcard and end-anchor patterns', () => {
  assert.strictEqual(pathMatches('/files/*.pdf', '/files/menu.pdf'), true);
  assert.strictEqual(pathMatches('/*.pdf$', '/files/menu.pdf'), true);
  assert.strictEqual(pathMatches('/*.pdf$', '/files/menu.pdf?x=1'), false);
  assert.strictEqual(pathMatches('/private', '/public'), false);
});

test('robots: a specific group hides the * group; no specific group means * applies', () => {
  const parsed = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nDisallow: /secret');
  assert.strictEqual(checkBot(parsed, 'GPTBot', '/').allowed, true, 'GPTBot uses its own group, not the * block');
  assert.strictEqual(checkBot(parsed, 'GPTBot', '/secret').allowed, false);
  assert.strictEqual(checkBot(parsed, 'ClaudeBot', '/').allowed, false, 'ClaudeBot has no group of its own, so * applies');
});

test('robots: no file means every crawler is allowed', () => {
  const audit = auditRobots(null, { found: false, statusCode: 404 });
  assert.strictEqual(audit.found, false);
  assert.deepStrictEqual(audit.blocked, []);
  assert.strictEqual(audit.bots.length, AI_BOTS.length);
  assert.ok(audit.bots.every((b) => b.allowed));
});

test('robots: the audit names the exact blocking rule per crawler', () => {
  const parsed = parseRobots('User-agent: GPTBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow: /articles');
  const audit = auditRobots(parsed, { pathname: '/articles/one' });
  assert.deepStrictEqual(audit.blocked.sort(), ['GPTBot', 'PerplexityBot'].sort());
  const gpt = audit.bots.find((b) => b.bot === 'GPTBot');
  assert.strictEqual(gpt.rule, 'Disallow: /');
  const claude = audit.bots.find((b) => b.bot === 'ClaudeBot');
  assert.strictEqual(claude.allowed, true);
});

// ---------------------------------------------------------------- JSON-LD

const ORG_PAGE = `<!DOCTYPE html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Organization","name":"Curam","url":"https://curam.example","logo":"https://curam.example/logo.png","sameAs":["https://x.com/curam"],"description":"Cellar cooling"},
  {"@type":"WebSite","name":"Curam","url":"https://curam.example"}
]}
</script>
</head><body></body></html>`;

test('schema: @graph entities are flattened and a complete Organization passes', () => {
  const result = validateSchema(ORG_PAGE);
  assert.strictEqual(result.blockCount, 1);
  assert.deepStrictEqual(result.types.sort(), ['Organization', 'WebSite'].sort());
  const org = result.entities.find((e) => e.label === 'Organization');
  assert.strictEqual(org.ok, true);
  assert.deepStrictEqual(org.missingRequired, []);
  assert.ok(result.score >= 80);
});

test('schema: a Product without an offer is not complete', () => {
  const entity = checkEntity({ '@type': 'Product', name: 'Cooler', image: 'https://x/y.jpg' });
  assert.strictEqual(entity.checked, true);
  assert.ok(entity.missingRequired.some((m) => m.startsWith('offers')), 'a product needs an offer or a review');
});

test('schema: LocalBusiness subtypes use the LocalBusiness rules', () => {
  const entity = checkEntity({ '@type': 'LiquorStore', name: 'Cellar', telephone: '123' });
  assert.strictEqual(entity.label, 'LocalBusiness');
  assert.deepStrictEqual(entity.missingRequired, ['address']);
});

test('schema: an invalid block is reported and does not stop the rest', () => {
  const html = `<script type="application/ld+json">{ not json }</script>${ORG_PAGE}`;
  const result = validateSchema(html);
  assert.strictEqual(result.errors.length, 1);
  assert.ok(result.types.includes('Organization'));
  assert.ok(result.findings.some((f) => f.severity === 'warn' && /invalid/i.test(f.title)));
});

test('schema: no structured data at all is a failure finding', () => {
  const result = validateSchema('<html><body>plain</body></html>');
  assert.strictEqual(result.blockCount, 0);
  assert.strictEqual(result.score, 0);
  assert.ok(result.findings.some((f) => f.severity === 'fail'));
});

test('schema: FAQPage and BreadcrumbList required properties', () => {
  assert.deepStrictEqual(checkEntity({ '@type': 'FAQPage' }).missingRequired, ['mainEntity']);
  assert.deepStrictEqual(checkEntity({ '@type': 'BreadcrumbList', itemListElement: [] }).missingRequired, ['itemListElement']);
});

test('schema: extractJsonLd ignores other script types', () => {
  const { blocks } = extractJsonLd('<script type="text/javascript">{"@type":"Organization"}</script>');
  assert.strictEqual(blocks.length, 0);
});

// ---------------------------------------------------------------- key facts

test('facts: numbers are matched with their units', () => {
  assert.strictEqual(matchFact('±0.5°C stability', 'The cabinet holds ±0.5°C.').present, true);
  assert.strictEqual(matchFact('±0.5°C stability', 'The cabinet holds ±0.5 amps.').present, false, 'the right number with the wrong unit is not a match');
  assert.strictEqual(matchFact('10A plug', 'It uses a standard 10 amp plug.').present, true);
  assert.strictEqual(matchFact('6–9 week lead time', 'Lead time is 6-9 weeks.').present, true);
  assert.strictEqual(matchFact('6–9 week lead time', 'Lead time is 6-9 months.').present, false);
});

test('facts: a range needs both ends', () => {
  const numbers = extractNumbers('6–9 week lead time').map((n) => n.value);
  assert.deepStrictEqual(numbers, [6, 9]);
  assert.strictEqual(matchFact('6–9 week lead time', 'About 9 weeks.').present, false);
});

test('facts: distinctive words carry a fact without numbers', () => {
  const result = matchFact('quiet compressor with vibration isolation', 'The cabinet uses a quiet compressor and vibration isolation mounts.');
  assert.strictEqual(result.present, true);
  assert.ok(result.confidence >= 0.6);
});

test('facts: coverage counts answers containing the fact', () => {
  const coverage = factCoverage(
    ['±0.5°C stability', '10A plug'],
    ['It holds ±0.5°C with a 10A plug.', 'It is a wine fridge.'],
  );
  assert.strictEqual(coverage[0].present, true);
  assert.strictEqual(coverage[0].answersFound, 1);
  assert.strictEqual(coverage[1].present, true);
  assert.ok(coverage[0].evidence.includes('0.5'));
});

test('facts: an empty fact list is not a failure', () => {
  assert.deepStrictEqual(factCoverage([], ['anything']), []);
  assert.strictEqual(matchFact('', 'anything').present, false);
});

// ---------------------------------------------------------------- scoring

function baseReport(overrides = {}) {
  return {
    url: 'https://curam.example',
    host: 'curam.example',
    brand: 'Curam',
    technical: {
      http: { status: 200, finalUrl: 'https://curam.example', xRobotsTag: '' },
      meta: { title: 'Cellar cooling', description: 'Temperature-stable cabinets', robots: '', lang: 'en-AU' },
      robots: { found: true, blocked: [], bots: [], sitemaps: [] },
      js: { raw: { words: 400, headings: 8 }, rendered: { words: 420, headings: 8 }, ratio: 0.95, renderError: '' },
    },
    schema: { score: 90, findings: [] },
    queries: [],
    facts: [],
    ...overrides,
  };
}

test('scoring: unmeasured areas are left out and the weights rescaled', () => {
  const scored = scoreReport(baseReport({ schema: { score: null, findings: [] } }));
  assert.strictEqual(scored.scores.schema, null);
  assert.deepStrictEqual(scored.scores.measured.sort(), ['readability', 'technical'].sort());
  assert.strictEqual(scored.scores.overall, Math.round((scored.scores.technical * 25 + scored.scores.readability * 15) / 40));
  assert.strictEqual(overallScore({ technical: null, readability: null, schema: null, citation: null, accuracy: null }), 0);
});

test('scoring: readability rewards server-rendered content and penalises JS-only pages', () => {
  assert.strictEqual(scoreReadability({ raw: { words: 400 }, rendered: { words: 420 }, renderError: '' }), 100);
  assert.strictEqual(scoreReadability({ raw: { words: 20 }, rendered: { words: 400 }, renderError: '' }), 15);
  assert.strictEqual(scoreReadability({ renderError: 'no browser' }), null, 'a failed render is unmeasured, not zero');
});

test('scoring: a blocked crawler and a noindex page produce fail suggestions', () => {
  const report = baseReport();
  report.technical.meta.robots = 'noindex,follow';
  report.technical.robots = {
    found: true,
    blocked: ['GPTBot'],
    sitemaps: [],
    bots: [
      { bot: 'GPTBot', label: 'OpenAI training crawler', allowed: false, rule: 'Disallow: /', reason: 'Blocked by "Disallow: /".' },
      { bot: 'ClaudeBot', label: 'Anthropic crawler', allowed: true, rule: null, reason: 'No rule.' },
    ],
  };
  const scored = scoreReport(report);
  assert.ok(scored.suggestions.some((s) => s.severity === 'fail' && /GPTBot/.test(s.title)));
  assert.ok(scored.suggestions.some((s) => s.severity === 'fail' && /not to index/.test(s.title)));
  assert.ok(scored.summary.includes('GPTBot'), 'the summary names the blocked crawler');
  assert.ok(scored.scores.technical < 100);
});

test('scoring: citation and mention are separate outcomes in the summary', () => {
  const report = baseReport({
    queries: [
      {
        query: 'best cellar cooler',
        answer: 'The Curam cabinet is a good choice.',
        citation: { inSearchResults: true, domainRank: 1, mentioned: true, brandMentioned: true, domainMentioned: false, citedInAnswer: false, urlsCited: [], score: 60 },
        factScore: 50,
        search: { results: [{ url: 'https://curam.example', title: 'Curam' }], error: '' },
      },
      {
        query: 'cellar cooling guide',
        answer: 'No source answers this.',
        citation: { inSearchResults: false, domainRank: null, mentioned: false, brandMentioned: false, domainMentioned: false, citedInAnswer: false, urlsCited: [], score: 0 },
        factScore: null,
        search: { results: [], error: '' },
      },
    ],
  });
  const scored = scoreReport(report);
  assert.ok(scored.summary.includes('mentioned in the answer 1/2'));
  assert.ok(scored.summary.includes('linked 0/2'));
  assert.ok(scored.suggestions.some((s) => s.severity === 'fail' && /No simulated answer linked/.test(s.title)));
  assert.strictEqual(scored.scores.citation, 30);
  assert.strictEqual(scored.scores.accuracy, 50);
});

test('scoring: a missing search key is reported as a setup issue, not a site failure', () => {
  const report = baseReport({
    queries: [{
      query: 'q',
      answer: '',
      citation: null,
      factScore: null,
      search: { results: [], error: 'Search API key not configured' },
    }],
  });
  const scored = scoreReport(report);
  assert.ok(scored.suggestions.some((s) => s.area === 'Setup' && /Live search/.test(s.title)));
});

// ---------------------------------------------------------------- Markdown

test('markdown: the report has every section and escapes table cells', () => {
  const scored = scoreReport(baseReport({
    queries: [{
      query: 'best cellar cooler',
      source: 'generated',
      model: 'claude-x',
      answer: 'The Curam cabinet holds ±0.5°C.\nIt is quiet.',
      citation: { inSearchResults: true, domainRank: 2, mentioned: true, brandMentioned: true, domainMentioned: false, citedInAnswer: true, urlsCited: ['https://curam.example/a'], otherUrls: [], score: 85 },
      factScore: 100,
      facts: [{ statement: '±0.5°C stability', present: true, confidence: 1, evidence: 'holds ±0.5°C' }],
      search: { provider: 'brave', results: [{ url: 'https://curam.example/a', title: 'Coolers | Curam', snippet: 'stable' }], error: '' },
    }],
    facts: [{ statement: '±0.5°C | stability', present: true, answersFound: 1, evidence: 'holds ±0.5°C' }],
  }));
  const md = buildMarkdown(scored, { createdAt: '2026-11-01T00:00:00Z' });
  for (const heading of ['# AI Visibility report', '## Scores', '## Suggestions', '## 1. Technical access', '### robots.txt and AI crawlers', '## 2. Readability without JavaScript', '## 3. Structured data', '## 4. Simulated questions', '## 5. Key facts across all answers']) {
    assert.ok(md.includes(heading), `missing "${heading}"`);
  }
  assert.ok(md.includes('| Area | Score |'));
  assert.ok(md.includes('GPTBot'), 'the crawler table lists GPTBot even when nothing is blocked');
  assert.ok(md.includes('\\|'), 'a pipe in a fact does not break the table');
  assert.ok(md.includes('https://curam.example/a'), 'cited URL appears');
});

test('markdown: a sparse report still renders', () => {
  const md = buildMarkdown({ url: 'https://x.example', host: 'x.example' });
  assert.ok(md.includes('# AI Visibility report: x.example'));
  assert.ok(md.includes('No suggestions'));
  assert.ok(md.includes('_Not measured._'));
});

console.log('AI Visibility tests passed');
