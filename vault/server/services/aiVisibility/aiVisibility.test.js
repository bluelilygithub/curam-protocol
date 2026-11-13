#!/usr/bin/env node
/**
 * AI Visibility: the pure parts of the audit, with no network, browser or database.
 * robots.txt grouping/matching, JSON-LD entity validation, key-fact matching, the
 * weighted score (including unmeasured areas), search-error detection, brand and host
 * matching, the assistant verdicts and response readers, and the Markdown report.
 *
 * Run: node server/services/aiVisibility/aiVisibility.test.js
 */
'use strict';

const assert = require('assert');
const { parseRobots, checkBot, auditRobots, pathMatches, AI_BOTS } = require('./robots');
const { extractJsonLd, validateSchema, checkEntity } = require('./schema');
const { matchFact, factCoverage, extractNumbers } = require('./facts');
const { scoreReport, overallScore, scoreReadability, WEIGHTS } = require('./scoring');
const { providerError } = require('./searchClient');
const { brandVariants, brandNamed, brandFromTitle, hostMatches, rankOf, rankScore, fallbackQueries, assistantVerdict } = require('./queryAnalysis');
const { readClaudeContent, readGeminiGrounding, readPerplexity, friendlyError } = require('./assistants');
const { userAgentFor } = require('./render');
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
  assert.deepStrictEqual(entity.missingRequired, [], 'a missing address is a choice, not a hard failure');
  assert.strictEqual(entity.addressChoice, true);
});

test('schema: a service-area business with areaServed needs no street address', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'HomeAndConstructionBusiness',
      name: 'Walk-In Wine Cabinets Australia',
      telephone: '1300',
      url: 'https://wiwc.com.au',
      image: 'x.jpg',
      areaServed: [{ '@type': 'Country', name: 'Australia' }, { '@type': 'City', name: 'Sydney' }, { '@type': 'City', name: 'Melbourne' }, { '@type': 'City', name: 'Perth' }],
    }],
  })}</script>`;
  const result = validateSchema(html);
  const lb = result.entities.find((e) => e.label === 'LocalBusiness');
  assert.strictEqual(lb.addressChoice, false);
  assert.strictEqual(lb.serviceArea, true);
  assert.ok(!result.findings.some((f) => /address/.test(f.title)), 'no address finding when areaServed is given');
  const city = result.entities.find((e) => e.label === 'City');
  assert.strictEqual(city.count, 3, 'repeated unchecked entities fold into one row');
  assert.strictEqual(result.entities.filter((e) => e.label === 'City').length, 1);
});

test('schema: no address and no areaServed is a warning offering both options', () => {
  const result = validateSchema(`<script type="application/ld+json">${JSON.stringify({ '@type': 'LocalBusiness', name: 'Shop' })}</script>`);
  const f = result.findings.find((x) => /no address or area served/.test(x.title));
  assert.ok(f && f.severity === 'warn');
  assert.ok(/areaServed/.test(f.recommendation) && /streetAddress/.test(f.recommendation));
  assert.ok(!result.findings.some((x) => x.severity === 'fail' && /address/.test(x.detail)));
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
  assert.strictEqual(scored.scores.overall, Math.round((scored.scores.technical * WEIGHTS.technical + scored.scores.readability * WEIGHTS.readability) / (WEIGHTS.technical + WEIGHTS.readability)));
  assert.strictEqual(overallScore({ technical: null, readability: null, schema: null, discoverability: null, assistants: null, accuracy: null }), 0);
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

function assistant(id, overrides = {}) {
  return { id, label: id === 'claude' ? 'Claude (web search)' : 'Gemini (Google Search)', model: `${id}-model`, answer: 'An answer.', sources: [], error: '', named: false, cited: false, score: 0, facts: [], factScore: null, ...overrides };
}

test('scoring: search ranking and each assistant are separate outcomes', () => {
  const report = baseReport({
    queries: [
      {
        query: 'best cellar cooler',
        search: { provider: 'brave', results: [{ url: 'https://curam.example' }], error: '' },
        rank: 1,
        discoverability: 100,
        assistants: [
          assistant('claude', { named: true, cited: true, score: 100, factScore: 100 }),
          assistant('gemini', { named: true, cited: false, score: 50, factScore: 0 }),
        ],
      },
      {
        query: 'cellar cooling guide',
        search: { provider: 'brave', results: [{ url: 'https://other.example' }], error: '' },
        rank: null,
        discoverability: 0,
        assistants: [
          assistant('claude', { score: 0 }),
          assistant('gemini', { score: null, answer: '', error: 'GEMINI_API_KEY is not set.' }),
        ],
      },
    ],
  });
  const scored = scoreReport(report);
  assert.strictEqual(scored.scores.discoverability, 50);
  assert.strictEqual(scored.scores.assistants, 50, 'the failed Gemini answer is left out, not counted as zero');
  assert.strictEqual(scored.scores.accuracy, 50);
  assert.ok(scored.summary.includes('top 10 for 1 of 2'));
  assert.ok(scored.summary.includes('Claude (web search) named it in 1/2 answers and cited the site in 1/2'));
  assert.ok(scored.suggestions.some((s) => s.area === 'Setup' && /Gemini/.test(s.title)), 'an assistant error is a setup issue');
  assert.ok(!scored.suggestions.some((s) => /No AI assistant named/.test(s.title)));
});

test('scoring: failed searches leave ranking unmeasured and say why', () => {
  const report = baseReport({
    queries: [{
      query: 'q',
      search: { provider: '', results: [], error: 'Brave: The provided API key is invalid. (HTTP 422)' },
      rank: null,
      discoverability: null,
      assistants: [],
    }],
  });
  const scored = scoreReport(report);
  assert.strictEqual(scored.scores.discoverability, null, 'a failed search is not "not found"');
  assert.ok(!scored.suggestions.some((s) => /not in the top 10/.test(s.title)));
  const setup = scored.suggestions.find((s) => s.area === 'Setup' && /Live search failed/.test(s.title));
  assert.ok(setup && /API key is invalid/.test(setup.detail));
});

test('scoring: nobody naming the business is a fail; template questions are flagged', () => {
  const scored = scoreReport(baseReport({
    querySource: 'template',
    queries: [{
      query: 'q',
      search: { provider: 'brave', results: [], error: '' },
      rank: null,
      discoverability: 0,
      assistants: [assistant('claude', { score: 0 })],
    }],
  }));
  assert.ok(scored.suggestions.some((s) => s.severity === 'fail' && /No AI assistant named/.test(s.title)));
  assert.ok(scored.suggestions.some((s) => s.severity === 'fail' && /as a source/.test(s.title)));
  assert.ok(scored.suggestions.some((s) => /made from templates/.test(s.title)));
});

// ---------------------------------------------------------------- search errors

test('search: provider error shapes are errors, not empty results', () => {
  assert.strictEqual(providerError('brave', { type: 'ErrorResponse', error: { detail: 'The provided API key is invalid.' } }, 422), 'Brave: The provided API key is invalid. (HTTP 422)');
  assert.strictEqual(providerError('brave', { type: 'ErrorResponse', error: { code: 'RATE_LIMITED' } }, 429), 'Brave: RATE_LIMITED (HTTP 429)');
  assert.strictEqual(providerError('serper', { message: 'Not enough credits' }, 400), 'Serper: Not enough credits (HTTP 400)');
  assert.strictEqual(providerError('serpapi', { error: 'Invalid API key.' }), 'SerpAPI: Invalid API key.');
  assert.strictEqual(providerError('brave', {}, 500), 'Brave: HTTP 500');
  assert.strictEqual(providerError('brave', { web: { results: [] } }, 200), '', 'a real empty result is not an error');
});

// ---------------------------------------------------------------- brand, host, questions

test('brand: variants catch the ways an answer names a business', () => {
  const v = brandVariants('Curam-Ai Protocol™', 'curam-ai.com.au');
  assert.ok(brandNamed('I would look at Curam AI for this.', v), 'Curam AI');
  assert.ok(brandNamed('CuramAI offers a protocol', v), 'CuramAI');
  assert.ok(brandNamed('see curam-ai.com.au', v), 'domain label');
  assert.ok(!brandNamed('A curated list of tools.', v), 'a word that only starts the same does not count');
  assert.ok(!brandNamed('Welcome home', brandVariants('Home', 'acme.com.au')), 'a page name is not a brand');
  assert.ok(brandNamed('Acme sells these.', brandVariants('Home', 'acme.com.au')), 'falls back to the domain label');
  assert.ok(brandNamed('Ask Bluegum about it', brandVariants('Bluegum Pty Ltd', 'bluegum.com.au')));
});

test('brand: a descriptive brand is not "named" by its product words (wiwc, 2026-11-13)', () => {
  const question = 'I need a walk in wine cabinet or fridge for my penthouse to protect my expensive wine collection';
  const v = brandVariants('Walk-In Wine Cabinets Australia', 'wiwc.com.au', question);
  assert.ok(!brandNamed('For a penthouse, a walk-in wine cabinet or a walk-in room is best.', v), 'product words are not the brand');
  assert.ok(!brandNamed('Several walk in wine cabinets suit this.', v), 'plural product words are not the brand');
  assert.ok(brandNamed('Walk-In Wine Cabinets Australia delivers these nationwide.', v), 'the full name counts');
  assert.ok(brandNamed('Try WIWC for a self-contained unit.', v), 'the domain label counts');
  assert.ok(!v.some((w) => w.join(' ') === 'walk in'), 'no two-word short form');
});

test('brand: variants the question itself contains are dropped', () => {
  const v = brandVariants('Cellar Cooling', 'acme.com.au', 'what is the best cellar cooling unit');
  assert.ok(!brandNamed('Cellar cooling units vary.', v));
  assert.ok(brandNamed('Acme makes them.', v));
});

test('render: the browser identity carries the real Chromium version, not a fixed one', () => {
  assert.ok(userAgentFor({ version: () => '149.0.7827.55' }).includes('Chrome/149.0.7827.55 '));
  assert.ok(userAgentFor(null).includes('Chrome/'), 'falls back when the version is unknown');
});

test('brand: brandFromTitle skips page names and the trademark sign', () => {
  assert.strictEqual(brandFromTitle('Curam-Ai Protocol™ | Systematised AI', 'curam-ai.com.au'), 'Curam-Ai Protocol');
  assert.strictEqual(brandFromTitle('Home | Acme Cellars', 'acme.com.au'), 'acme');
  assert.strictEqual(brandFromTitle('Acme - Wine cellars', 'acme.com.au'), 'Acme');
});

test('host: subdomains of the site count, look-alikes do not', () => {
  assert.ok(hostMatches('shop.curam.example', 'curam.example'));
  assert.ok(hostMatches('www.curam.example', 'curam.example'));
  assert.ok(!hostMatches('notcuram.example', 'curam.example'));
  assert.strictEqual(rankOf([{ url: 'https://a.example' }, { url: 'https://blog.curam.example/x' }], 'curam.example'), 2);
  assert.strictEqual(rankScore(1), 100);
  assert.strictEqual(rankScore(7), 50);
  assert.strictEqual(rankScore(null), 0);
});

test('questions: templates keep a hyphenated brand and describe the offer', () => {
  const q = fallbackQueries({ title: 'Curam-Ai Protocol™ | Systematised AI Implementation for Professional Services', brand: 'Curam-Ai Protocol', host: 'curam-ai.com.au' });
  assert.strictEqual(q.length, 4);
  assert.ok(q[0].startsWith('systematised ai implementation for professional services'), q[0]);
  assert.ok(!q.some((x) => /\bbest curam\b|who sells/.test(x)), q.join(' / '));
});

test('assistants: named and cited are judged per assistant', () => {
  const variants = brandVariants('Curam', 'curam.example');
  const v = assistantVerdict({ id: 'claude', answer: 'Curam is one option.', sources: [{ url: 'https://other.example/a' }, { url: 'https://www.curam.example/guide' }] }, { domain: 'curam.example', variants });
  assert.strictEqual(v.named, true);
  assert.strictEqual(v.cited, true);
  assert.strictEqual(v.score, 100);
  const g = assistantVerdict({ id: 'gemini', answer: 'Several firms do this.', sources: [{ url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc', domain: 'curam.example' }] }, { domain: 'curam.example', variants });
  assert.strictEqual(g.named, false);
  assert.strictEqual(g.cited, true, 'a Gemini source is matched by its domain title');
  assert.strictEqual(g.score, 50);
  const failed = assistantVerdict({ id: 'perplexity', answer: '', sources: [], error: 'timed out' }, { domain: 'curam.example', variants });
  assert.strictEqual(failed.score, null, 'a failed assistant is unmeasured');
});

test('assistants: response readers pull answers and sources', () => {
  const c = readClaudeContent([
    { type: 'server_tool_use', name: 'web_search' },
    { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://a.example', title: 'A' }] },
    { type: 'text', text: 'Curam is ', citations: [{ url: 'https://curam.example', title: 'Curam' }] },
    { type: 'text', text: 'good.' },
  ]);
  assert.strictEqual(c.text, 'Curam is good.');
  assert.deepStrictEqual(c.cited.map((s) => s.url), ['https://curam.example']);
  assert.deepStrictEqual(c.seen.map((s) => s.url), ['https://a.example']);
  const g = readGeminiGrounding({ candidates: [{ groundingMetadata: { groundingChunks: [{ web: { uri: 'https://redirect', title: 'curam.example' } }] } }] });
  assert.strictEqual(g[0].domain, 'curam.example');
  const p = readPerplexity({ choices: [{ message: { content: 'Answer' } }], citations: ['https://curam.example/x'] });
  assert.strictEqual(p.answer, 'Answer');
  assert.strictEqual(p.sources[0].url, 'https://curam.example/x');
});

test('assistants: provider errors are shortened to a readable reason', () => {
  assert.strictEqual(friendlyError(new Error('401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_1"}')), '401: invalid x-api-key');
  assert.strictEqual(friendlyError(new Error('[GoogleGenerativeAI Error]: Error fetching from https://x/models/g:generateContent: [400 Bad Request] API key not valid. Please pass a valid API key. [{"@type":"x"}]')), '400: API key not valid. Please pass a valid API key.');
  assert.strictEqual(friendlyError(new Error('Perplexity request timed out.')), 'Perplexity request timed out.');
});

// ---------------------------------------------------------------- Markdown

test('markdown: a version 2 report shows ranking and each assistant', () => {
  const scored = scoreReport(baseReport({
    version: 2,
    assistantsAsked: [{ id: 'claude', label: 'Claude (web search)', model: 'claude-x' }],
    queries: [{
      query: 'best cellar cooler',
      source: 'user',
      search: { provider: 'brave', results: [{ url: 'https://curam.example/a', title: 'Coolers | Curam' }], error: '' },
      rank: 1,
      discoverability: 100,
      assistants: [assistant('claude', { answer: 'Curam holds ±0.5°C.', named: true, namedAs: 'curam', cited: true, citedUrls: ['https://curam.example/a'], score: 100, sources: [{ url: 'https://curam.example/a', title: 'Coolers' }] }),
        assistant('gemini', { answer: '', score: null, error: 'GEMINI_API_KEY is not set.' })],
    }],
    facts: [{ statement: '±0.5°C | stability', present: true, answersFound: 1, evidence: 'holds ±0.5°C' }],
  }));
  const md = buildMarkdown(scored, { createdAt: '2026-11-13T00:00:00Z' });
  for (const s of ['**AI assistants asked:** Claude (web search) (claude-x)', '| Search ranking | 100/100 |', '| Named by AI assistants |', '## 4. Buyer questions', '#### Claude (web search)', 'Named the business: yes', 'position 1', 'Could not answer: GEMINI_API_KEY is not set.', '\\|']) {
    assert.ok(md.includes(s), `missing "${s}"`);
  }
  assert.ok(!md.includes('Citation in answers'));
});

test('markdown: an earlier (version 1) saved report still renders as it did', () => {
  const md = buildMarkdown({
    url: 'https://curam.example',
    host: 'curam.example',
    scores: { overall: 60, technical: 90, readability: 100, schema: 50, citation: 30, accuracy: null, measured: ['technical'] },
    queries: [{
      query: 'best cellar cooler',
      source: 'generated',
      model: 'claude-x',
      answer: 'The Curam cabinet.',
      citation: { inSearchResults: true, domainRank: 2, mentioned: true, brandMentioned: true, domainMentioned: false, citedInAnswer: true, urlsCited: ['https://curam.example/a'], otherUrls: [], score: 85 },
      facts: [],
      search: { provider: 'brave', results: [{ url: 'https://curam.example/a', title: 'Coolers' }], error: '' },
    }],
  });
  for (const s of ['## 4. Simulated questions', '| Citation in answers | 30/100 |', 'Linked in the answer: yes', 'https://curam.example/a']) {
    assert.ok(md.includes(s), `missing "${s}"`);
  }
});

test('markdown: a sparse report still renders', () => {
  const md = buildMarkdown({ url: 'https://x.example', host: 'x.example' });
  assert.ok(md.includes('# AI Visibility report: x.example'));
  assert.ok(md.includes('No suggestions'));
  assert.ok(md.includes('_Not measured._'));
});

console.log('AI Visibility tests passed');
