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
  technical: 20,
  readability: 15,
  schema: 15,
  discoverability: 15,
  assistants: 25,
  accuracy: 10,
};

const AREA_LABELS = {
  technical: 'Technical access',
  readability: 'No-JavaScript readability',
  schema: 'Structured data',
  discoverability: 'Search ranking',
  assistants: 'Named by AI assistants',
  accuracy: 'Key-fact accuracy',
};

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));

function average(values) {
  // null/undefined mean "not measured" and must not count as zero.
  const nums = (values || []).filter((v) => v != null && v !== '').map(Number).filter((n) => Number.isFinite(n));
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

function scoreDiscoverability(queries) {
  return average((queries || []).map((q) => q && q.discoverability));
}

/** Average over every assistant answer that came back; failed answers are left out. */
function scoreAssistants(queries) {
  const all = [];
  for (const q of queries || []) for (const a of (q && q.assistants) || []) all.push(a.score);
  return average(all.filter((v) => v != null));
}

function scoreAccuracy(queries) {
  const all = [];
  for (const q of queries || []) for (const a of (q && q.assistants) || []) all.push(a.factScore);
  return average(all.filter((v) => v != null));
}

/** Per assistant across all questions: asked, answered, named, cited, and the first errors. */
function assistantTotals(queries) {
  const map = new Map();
  for (const q of queries || []) {
    for (const a of (q && q.assistants) || []) {
      const t = map.get(a.id) || { id: a.id, label: a.label, model: a.model, asked: 0, answered: 0, named: 0, cited: 0, errors: [] };
      t.asked += 1;
      if (a.score != null) {
        t.answered += 1;
        if (a.named) t.named += 1;
        if (a.cited) t.cited += 1;
      } else if (a.error && !t.errors.includes(a.error)) {
        t.errors.push(a.error);
      }
      map.set(a.id, t);
    }
  }
  return [...map.values()];
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
  const searched = (queries || []).filter((q) => q.search && !q.search.error);
  const ranked = searched.filter((q) => q.rank);
  const blocked = (technical && technical.robots && technical.robots.blocked) || [];
  const factsFound = (facts || []).filter((f) => f.present).length;
  const parts = [];

  parts.push(`${host || url} scored ${scores.overall}/100 for AI visibility.`);
  if (blocked.length) parts.push(`${blocked.length} AI crawler${blocked.length === 1 ? ' is' : 's are'} blocked in robots.txt (${blocked.slice(0, 4).join(', ')}${blocked.length > 4 ? '…' : ''}).`);
  else parts.push('No AI crawlers are blocked in robots.txt.');
  if (searched.length) {
    parts.push(`In search results the site ranked in the top 10 for ${ranked.length} of ${searched.length} question${searched.length === 1 ? '' : 's'}.`);
  }
  const totals = assistantTotals(queries).filter((t) => t.answered);
  if (totals.length) {
    parts.push(totals.map((t) => `${t.label} named it in ${t.named}/${t.answered} answers and cited the site in ${t.cited}/${t.answered}`).join('; ') + '.');
  }
  if ((facts || []).length) parts.push(`Key facts present in the assistants' answers: ${factsFound}/${facts.length}.`);
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
  const searched = queries.filter((q) => q.search && !q.search.error);
  if (searched.length && !searched.some((q) => q.rank)) {
    add('warn', 'Search ranking', 'The site is not in the top 10 search results for any question', `${searched.length} question${searched.length === 1 ? ' was' : 's were'} searched (${searched[0].search.provider || 'search'}); ${report.host} did not appear in the first 10 results for any of them.`, 'AI assistants that search the web start from results like these. Publish a page that answers each question directly (a guide, comparison or specification page with the facts written out) and link to it from the home page.');
  }

  const totals = assistantTotals(queries);
  const answered = totals.filter((t) => t.answered);
  const namedAny = answered.some((t) => t.named);
  const citedAny = answered.some((t) => t.cited);
  if (answered.length) {
    if (!namedAny) {
      add('fail', 'AI assistants', 'No AI assistant named the business', `Asked: ${answered.map((t) => `${t.label} (${t.answered} answer${t.answered === 1 ? '' : 's'})`).join(', ')}. None named ${report.brand || report.host}.`, 'Make the brand, the offer and the location explicit in the page copy and in Organization/LocalBusiness markup, and get the business mentioned on sites these assistants already cite (directories, reviews, industry lists).');
    }
    if (!citedAny) {
      add('fail', 'AI assistants', 'No AI assistant used a page from the site as a source', `None of the answers listed a ${report.host} page among its sources.`, 'Write a page that answers each question in plain text near the top, so an assistant searching the web finds it and can quote it.');
    }
    for (const t of answered) {
      if ((namedAny || citedAny) && t.named === 0 && t.cited === 0) {
        add('warn', 'AI assistants', `${t.label} did not mention the site`, `${t.label} answered ${t.answered} question${t.answered === 1 ? '' : 's'} without naming the business or citing the site.`, 'Assistants search different indexes (Claude and Perplexity use their own web search, Gemini uses Google). Check the site is indexed in Bing and Google, and that robots.txt allows the crawler for this assistant.');
      }
    }
  }
  for (const t of totals) {
    if (t.errors.length) {
      add('warn', 'Setup', `${t.label} could not answer${t.answered ? ' every question' : ''}`, t.errors[0], 'Check the key and model for this assistant in Settings, then run the audit again. Questions it could not answer are left out of the score, not counted as zero.');
    }
  }
  if (queries.length && !totals.length) {
    add('info', 'Setup', 'No AI assistants were asked', 'No assistant was selected or connected, so only search ranking was checked.', 'Connect an Anthropic or Gemini model in Settings → Models (or add PERPLEXITY_API_KEY), then tick it on the new-audit screen.');
  }
  if (report.querySource === 'template') {
    add('info', 'Setup', 'The questions were made from templates', report.queryGenerationError ? `The model could not write questions: ${report.queryGenerationError}` : 'No model was available to write questions from the page.', 'Run the audit again with three to six questions of your own: the questions a real customer would ask.');
  }

  for (const fact of report.facts || []) {
    if (fact.present) continue;
    add('warn', 'Accuracy', `A key fact is missing from the answers: "${fact.statement}"`, fact.evidence ? `Closest text found: "${fact.evidence}"` : 'No assistant stated this fact.', 'Write this fact in plain text on the page (and in the product/service schema). Numbers with units are what an answer repeats.');
  }

  if (!(report.facts || []).length && answered.length) {
    add('info', 'Accuracy', 'No key facts were supplied', 'Without key facts the audit cannot check whether answers state them accurately.', 'Next run, add 3–5 facts with units (for example "±0.5°C stability", "10A standard plug", "6–9 week lead time").');
  }

  if (queries.some((q) => q.search && q.search.error)) {
    const first = queries.find((q) => q.search && q.search.error);
    add('warn', 'Setup', 'Live search failed, so search ranking was not measured', first.search.error, 'Check SEARCH_API_KEY (Brave, Serper or SerpAPI) in Settings or the environment: the key may be invalid, out of credit or rate-limited.');
  }

  if (!queries.length) {
    add('info', 'Setup', 'No questions were run', 'The audit ran the technical checks only.', 'Re-run with at least three buyer questions, or let the audit generate them from the page.');
  }

  const order = { fail: 0, warn: 1, info: 2, pass: 3 };
  return out.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
}

/** Attach scores, summary and suggestions to a report object. Pure. */
function scoreReport(report) {
  const queries = report.queries || [];
  const technical = scoreTechnical(report.technical);
  const readability = scoreReadability(report.technical && report.technical.js);
  const schema = report.schema && typeof report.schema.score === 'number' ? clamp(report.schema.score) : null;
  const discoverability = scoreDiscoverability(queries);
  const assistants = scoreAssistants(queries);
  const accuracy = scoreAccuracy(queries);
  const areas = { technical, readability, schema, discoverability, assistants, accuracy };

  const scores = {
    ...areas,
    overall: overallScore(areas),
    measured: Object.entries(areas).filter(([, v]) => v != null).map(([k]) => k),
  };

  const next = { ...report, scores, assistantTotals: assistantTotals(queries) };
  next.summary = buildSummary({ url: next.url, host: next.host, scores, technical: next.technical, queries, facts: next.facts });
  next.suggestions = buildSuggestions(next);
  return next;
}

module.exports = {
  WEIGHTS,
  AREA_LABELS,
  assistantTotals,
  scoreDiscoverability,
  scoreAssistants,
  average,
  scoreTechnical,
  scoreReadability,
  scoreAccuracy,
  overallScore,
  buildSummary,
  buildSuggestions,
  scoreReport,
};
