'use strict';

/**
 * Scores and suggestions for the AI Visibility audit.
 *
 * The overall number is a weighted average of five areas. When an area could not be
 * measured (no browser, no search key, no key facts supplied) it is left out and the
 * remaining weights are rescaled, rather than scored zero — a missing measurement is
 * not the same as a failure, and the report says which areas were measured.
 */

const WEIGHTS = {
  technical: 25,
  readability: 15,
  schema: 20,
  citation: 25,
  accuracy: 15,
};

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

function average(values) {
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function scoreTechnical(technical) {
  const t = technical || {};
  let score = 100;

  const status = Number(t.http && t.http.status);
  if (status >= 400) score -= 60;
  else if (status >= 300 && status !== 0) score -= 5;

  const blocked = (t.robots && t.robots.blocked) || [];
  score -= Math.min(40, blocked.length * 8);

  const meta = t.meta || {};
  if (!String(meta.title || '').trim()) score -= 15;
  else if (String(meta.title).length > 65) score -= 3;
  if (!String(meta.description || '').trim()) score -= 10;
  if (!String(meta.lang || '').trim()) score -= 5;
  if (/noindex/i.test(String(meta.robots || ''))) score -= 40;
  if (/noindex/i.test(String(t.http && t.http.xRobotsTag || ''))) score -= 40;

  return clamp(score);
}

function scoreReadability(js) {
  if (!js || js.renderError) return null;
  const rawWords = Number(js.raw && js.raw.words) || 0;
  const jsWords = Number(js.rendered && js.rendered.words) || 0;
  if (!jsWords) return rawWords >= 100 ? 90 : 20;

  const ratio = rawWords / jsWords;
  if (ratio >= 0.85) return clamp(95 + (jsWords >= 200 ? 5 : 0));
  if (ratio >= 0.65) return 85;
  if (ratio >= 0.45) return 65;
  if (ratio >= 0.25) return 45;
  if (ratio >= 0.1) return 30;
  return 15;
}

function scoreCitations(queries) {
  const list = (queries || []).filter((q) => q && q.citation);
  return average(list.map((q) => q.citation.score));
}

function scoreAccuracy(queries) {
  const list = (queries || []).filter((q) => q && q.factScore != null);
  return average(list.map((q) => q.factScore));
}

function overallScore(categories) {
  let total = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(WEIGHTS)) {
    const value = categories[key];
    if (value == null) continue;
    total += value * w;
    weight += w;
  }
  return weight ? clamp(total / weight) : 0;
}

function buildSummary({ url, host, scores, technical, queries, facts }) {
  const tested = (queries || []).length;
  const answered = (queries || []).filter((q) => q.answer).length;
  const cited = (queries || []).filter((q) => q.citation && q.citation.citedInAnswer).length;
  const mentioned = (queries || []).filter((q) => q.citation && q.citation.mentioned).length;
  const found = (queries || []).filter((q) => q.citation && q.citation.inSearchResults).length;
  const blocked = (technical && technical.robots && technical.robots.blocked) || [];
  const factsFound = (facts || []).filter((f) => f.present).length;
  const parts = [];

  parts.push(`${host || url} scored ${scores.overall}/100 for AI visibility.`);
  if (blocked.length) parts.push(`${blocked.length} AI crawler${blocked.length === 1 ? ' is' : 's are'} blocked in robots.txt (${blocked.slice(0, 4).join(', ')}${blocked.length > 4 ? '…' : ''}).`);
  else parts.push('No AI crawlers are blocked in robots.txt.');
  if (tested) {
    parts.push(`Across ${tested} simulated question${tested === 1 ? '' : 's'}: found in search results ${found}/${tested}, mentioned in the answer ${mentioned}/${tested}, linked ${cited}/${tested}${answered < tested ? `, ${tested - answered} could not be answered` : ''}.`);
  }
  if ((facts || []).length) parts.push(`Key facts present in the answers: ${factsFound}/${facts.length}.`);
  return parts.join(' ');
}

function buildSuggestions(report) {
  const out = [];
  const add = (severity, area, title, detail, recommendation) => {
    out.push({ severity, area, title, detail, recommendation });
  };

  const technical = report.technical || {};
  const meta = technical.meta || {};
  const robots = technical.robots || {};
  const js = technical.js || {};
  const schema = report.schema || {};

  for (const bot of robots.bots || []) {
    if (bot.allowed) continue;
    add('fail', 'Access', `robots.txt blocks ${bot.bot}`, bot.reason, `If you want this page read by ${bot.label}, remove the ${bot.rule} rule for ${bot.bot} (or add "Allow: /" for that user-agent).`);
  }

  if (/noindex/i.test(String(meta.robots || '')) || /noindex/i.test(String(technical.http && technical.http.xRobotsTag || ''))) {
    add('fail', 'Access', 'The page tells crawlers not to index it', meta.robots || technical.http?.xRobotsTag || '', 'Remove noindex from this public page. No amount of structured data or good copy will be cited while it is set.');
  }
  if (!String(meta.title || '').trim()) add('warn', 'Content', 'The page has no title', 'No <title> element.', 'Add a descriptive title that names what the page sells and where.');
  if (!String(meta.description || '').trim()) add('warn', 'Content', 'The page has no meta description', 'No meta description.', 'Add a one-sentence description with the offer, location and a concrete detail an answer could quote.');
  if (!String(meta.lang || '').trim()) add('warn', 'Content', 'The page has no lang attribute', 'The <html> element has no lang.', 'Set lang="en-AU" (or the correct language) so an engine knows how to read the page.');

  if (js.renderError) {
    add('info', 'Readability', 'The JavaScript-rendered version could not be read', js.renderError, 'The no-JavaScript result is still valid, but re-run the audit to compare the rendered page.');
  } else if (js.ratio != null && js.ratio < 0.6) {
    add('fail', 'Readability', 'Most of the page only exists after JavaScript runs', `The raw HTML has ${js.raw?.words || 0} words against ${js.rendered?.words || 0} after rendering (${Math.round((js.ratio || 0) * 100)}%).`, 'Render the main copy, headings, prices and specifications in the server HTML (SSR or static HTML) so a crawler that does not run JavaScript still reads the offer.');
  } else if (js.ratio != null && js.ratio < 0.85) {
    add('warn', 'Readability', 'Some content is added by JavaScript', `The raw HTML has ${js.raw?.words || 0} words against ${js.rendered?.words || 0} after rendering (${Math.round((js.ratio || 0) * 100)}%).`, 'Move the important paragraphs and specifications into the initial HTML. Decorative and interactive extras can stay client-side.');
  }

  for (const finding of schema.findings || []) {
    if (finding.severity === 'pass') continue;
    add(finding.severity === 'fail' ? 'fail' : finding.severity === 'warn' ? 'warn' : 'info', 'Structured data', finding.title, finding.detail, finding.recommendation);
  }

  const queries = report.queries || [];
  const cited = queries.filter((q) => q.citation && q.citation.citedInAnswer).length;
  const mentioned = queries.filter((q) => q.citation && q.citation.mentioned).length;
  if (queries.length) {
    if (cited === 0) {
      add('fail', 'Citation', 'No simulated answer linked to the site', `None of the ${queries.length} answers quoted a ${report.host} URL.`, 'Publish a page that directly answers each question — a comparison, buying guide or specification page with the facts written out, not just product cards. That is the page an answer engine can cite.');
    } else if (cited < Math.ceil(queries.length / 2)) {
      add('warn', 'Citation', 'The site is linked in fewer than half the answers', `${cited} of ${queries.length} answers linked to ${report.host}.`, 'Strengthen the pages that answer the remaining questions, or add a section to the current page that addresses them directly.');
    }
    if (mentioned === 0) {
      add('fail', 'Citation', 'The brand is never named in the answers', 'The model answered without naming the business or its domain.', 'Make the brand, the offer and the location explicit in the page copy and in Organization/LocalBusiness markup so an answer can name it confidently.');
    }
  }

  for (const fact of report.facts || []) {
    if (fact.present) continue;
    add('warn', 'Accuracy', `A key fact is missing from the answers: "${fact.statement}"`, fact.evidence ? `Closest text found: "${fact.evidence}"` : 'The fact was not stated in any answer.', 'Write this fact in plain text on the page (and in the product/service schema). Numbers with units are what an answer engine repeats.');
  }

  if (!(report.facts || []).length) {
    add('info', 'Accuracy', 'No key facts were supplied', 'Without key facts the audit cannot check whether answers state them accurately.', 'Next run, add 3–5 facts with units (for example "±0.5°C stability", "10A standard plug", "6–9 week lead time").');
  }

  if (queries.some((q) => q.search && q.search.error)) {
    const first = queries.find((q) => q.search && q.search.error);
    add('warn', 'Setup', 'Live search was unavailable for some questions', first.search.error, 'Add SEARCH_API_KEY (Brave, Serper or SerpAPI) in Settings or the environment so the audit can check real search discovery, not just the model answer.');
  }

  if (!queries.length) {
    add('info', 'Setup', 'No questions were simulated', 'The audit ran the technical checks only.', 'Re-run with at least three buyer questions, or let the audit generate them from the page.');
  }

  const order = { fail: 0, warn: 1, info: 2, pass: 3 };
  return out.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
}

/** Attach scores, summary and suggestions to a report object. Pure. */
function scoreReport(report) {
  const technical = scoreTechnical(report.technical);
  const readability = scoreReadability(report.technical && report.technical.js);
  const schema = report.schema && typeof report.schema.score === 'number' ? clamp(report.schema.score) : null;
  const citation = scoreCitations(report.queries);
  const accuracy = scoreAccuracy(report.queries);

  const scores = {
    technical,
    readability,
    schema,
    citation,
    accuracy,
    overall: overallScore({ technical, readability, schema, citation, accuracy }),
    measured: Object.entries({ technical, readability, schema, citation, accuracy })
      .filter(([, v]) => v != null)
      .map(([k]) => k),
  };

  const next = { ...report, scores };
  next.summary = buildSummary({ url: next.url, host: next.host, scores, technical: next.technical, queries: next.queries, facts: next.facts });
  next.suggestions = buildSuggestions(next);
  return next;
}

module.exports = {
  WEIGHTS,
  average,
  scoreTechnical,
  scoreReadability,
  scoreCitations,
  scoreAccuracy,
  overallScore,
  buildSummary,
  buildSuggestions,
  scoreReport,
};
