'use strict';

/**
 * AI Visibility audit orchestration + storage.
 *
 * One run:
 *   1. fetch the page as a crawler would (SSRF-safe, no JavaScript);
 *   2. fetch and parse robots.txt, then check the AI crawlers individually;
 *   3. render the page in Chromium and compare the readable content;
 *   4. validate JSON-LD entities;
 *   5. generate (or accept) buyer questions; for each, a ranking search plus real AI
 *      assistants (Claude web search, Gemini with Google Search, Perplexity) that search
 *      for themselves;
 *   6. check named / cited per assistant and the supplied key facts;
 *   7. score, write suggestions, save the report.
 *
 * A run takes minutes, so it runs in the background: startAudit() saves a row marked
 * 'running' and answers at once; the page polls the row until it is 'done' or 'failed'.
 *
 * Nothing here writes outside this module and its table.
 */

const { pool } = require('../../db');
const { fetchHtml, fetchOnce, fetchDirect, htmlToText, extractTitle, decodeEntities, normaliseHttpUrl } = require('../htmlFetch');
const { checkSsrf } = require('../../utils/safeFetch');
const { getModelsForUser, getVaultModelsConfigForUser, pickTextModel, isNonTextModel } = require('../modelResolver');
const { parseRobots, auditRobots } = require('./robots');
const { validateSchema } = require('./schema');
const { renderPage } = require('./render');
const { generateQueries, runQuery, hostOf, brandFromTitle } = require('./queryAnalysis');
const { listAssistants } = require('./assistants');
const { factCoverage } = require('./facts');
const { scoreReport } = require('./scoring');
const { buildMarkdown } = require('./markdown');

const MAX_QUERIES = 6;
const MAX_FACTS = 12;
const REPORT_VERSION = 2;
// A run normally takes one to four minutes. One still marked running after this long was
// cut off (a restart or a crash) and is shown as failed.
const STALE_RUN_MS = 20 * 60 * 1000;

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function metaContent(html, name) {
  const text = String(html || '');
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']{1,500})["']`, 'i');
  const m = text.match(re);
  if (m) return decodeEntities(m[1].replace(/\s+/g, ' ').trim());
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']{1,500})["'][^>]*(?:name|property)=["']${name}["']`, 'i');
  const m2 = text.match(re2);
  return m2 ? decodeEntities(m2[1].replace(/\s+/g, ' ').trim()) : '';
}

function countWords(text) {
  const words = String(text || '').trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return words ? words.length : 0;
}

function countHeadings(html) {
  return (String(html || '').match(/<h[1-3]\b/gi) || []).length;
}

function normaliseList(value, max) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v == null ? '' : v).trim()).filter(Boolean).slice(0, max);
  }
  return String(value == null ? '' : value)
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, max);
}

async function resolveModel(userId, requested) {
  const id = String(requested || '').trim();
  if (id) {
    const { models } = await getVaultModelsConfigForUser(userId);
    const match = (models || []).find((m) => String(m.id).trim() === id);
    if (!match || isNonTextModel(match)) {
      const err = new Error('That model is not a connected text model in the vault_models inventory.');
      err.status = 400;
      throw err;
    }
    return id;
  }
  const tiers = await getModelsForUser(userId);
  return pickTextModel(tiers, 'standard');
}

async function fetchRobots(finalUrl) {
  let origin;
  try { origin = new URL(finalUrl).origin; } catch { return { found: false, statusCode: 0, url: '', error: 'Could not build the robots.txt address.' }; }
  const robotsUrl = `${origin}/robots.txt`;
  try {
    const res = await fetchDirect(robotsUrl, 3, 10000);
    const body = String(res.body || '');
    const found = res.statusCode >= 200 && res.statusCode < 300 && body.trim().length > 0;
    return {
      found,
      statusCode: res.statusCode,
      url: robotsUrl,
      body: found ? body.slice(0, 200000) : '',
      error: '',
    };
  } catch (err) {
    return { found: false, statusCode: 0, url: robotsUrl, body: '', error: err.message };
  }
}

function buildTechnical({ fetchResult, html, robotsFetch }) {
  const title = extractTitle(html) || '';
  const description = metaContent(html, 'description');
  const robotsMeta = metaContent(html, 'robots');
  const langMatch = String(html || '').match(/<html\b[^>]*\blang=["']([^"']{1,20})["']/i);
  const canonicalMatch = String(html || '').match(/<link\b[^>]*\brel=["']canonical["'][^>]*\bhref=["']([^"']{1,500})["']/i);

  const rawText = htmlToText(html, 30000);
  const robotsParsed = parseRobots(robotsFetch.body);
  const robots = auditRobots(robotsParsed, {
    pathname: (() => { try { return new URL(fetchResult.finalUrl || '').pathname || '/'; } catch { return '/'; } })(),
    found: robotsFetch.found,
    statusCode: robotsFetch.statusCode,
    url: robotsFetch.url,
    error: robotsFetch.error,
  });

  return {
    http: {
      status: fetchResult.statusCode || 0,
      finalUrl: fetchResult.finalUrl || '',
      xRobotsTag: fetchResult.xRobotsTag || '',
      redirects: (fetchResult.redirectChain || []).length,
    },
    meta: {
      title,
      description,
      robots: robotsMeta,
      lang: langMatch ? decodeEntities(langMatch[1]) : '',
      canonical: canonicalMatch ? decodeEntities(canonicalMatch[1]) : '',
    },
    robots,
    rawText,
    rawWords: countWords(rawText),
    rawHeadings: countHeadings(html),
  };
}

async function buildReadability(technical, finalUrl) {
  let rendered = null;
  let renderError = '';
  try {
    rendered = await renderPage(finalUrl, { timeoutMs: 20000 });
  } catch (err) {
    renderError = err.message;
  }

  const raw = { words: technical.rawWords, headings: technical.rawHeadings };
  if (!rendered) {
    return {
      raw,
      rendered: { words: 0, headings: 0 },
      ratio: null,
      renderError,
      verdict: 'not measured',
    };
  }

  const renderedWords = countWords(rendered.text);
  const ratio = renderedWords ? Math.min(1, raw.words / renderedWords) : null;
  return {
    raw,
    rendered: { words: renderedWords, headings: (rendered.headings || []).length },
    ratio,
    renderError: '',
    verdict: ratio == null ? 'unknown' : ratio >= 0.85 ? 'readable' : ratio >= 0.6 ? 'mostly readable' : 'JavaScript-dependent',
    finalUrl: rendered.finalUrl,
    headings: (rendered.headings || []).slice(0, 20),
  };
}

// Some hosts drop the first connection (a firewall, or an HTTP/2 quirk), and Node reports a bare
// "socket hang up". The shared fetchHtml retries different identities only for thin responses, not for
// errors, and other tools rely on its current behaviour, so the retry lives here: a couple of plain,
// polite requests, then a sentence a person can act on instead of a raw technical error.
const CONNECTION_DROPPED = /socket hang up|socket hung up|ECONNRESET|ECONNABORTED|EPIPE|EPROTO|close_notify|network socket disconnected/i;

// Plain identities only. An earlier version retried as Googlebot, which made the audit read
// whatever a site serves Google rather than what an AI crawler or a visitor receives.
const PLAIN_IDENTITIES = [
  { headers: {} },
  {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-AU,en;q=0.9',
    },
  },
];

async function fetchPage(url) {
  try {
    return await fetchHtml(url);
  } catch (err) {
    if (!CONNECTION_DROPPED.test(String(err && err.message))) throw err;
  }
  for (const identity of PLAIN_IDENTITIES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetchOnce(url, 5, 15000, identity.headers, {}, {
        'User-Agent': identity.headers['User-Agent'] || 'Mozilla/5.0 (compatible; VaultAI/1.0)',
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      });
      if (res && res.statusCode) return { ...res, via: res.via || 'direct' };
    } catch { /* try the next identity */ }
  }
  const friendly = new Error('The site closed the connection before the page could be read. It may refuse automated visits; try again in a moment, or audit a different page on the same site.');
  friendly.status = 502;
  throw friendly;
}

function cleanInput(input = {}) {
  const wanted = Array.isArray(input.assistants)
    ? input.assistants.map((a) => String(a || '').trim()).filter(Boolean)
    : null;
  return {
    url: String(input.url || '').trim(),
    name: String(input.name || '').trim().slice(0, 120),
    brand: String(input.brand || '').trim().slice(0, 120),
    modelId: String(input.modelId || '').trim(),
    queries: normaliseList(input.queries, MAX_QUERIES),
    facts: normaliseList(input.facts, MAX_FACTS),
    assistants: wanted,
  };
}

async function setProgress(id, progress) {
  await pool.query(
    `UPDATE ai_visibility_audits SET progress=$2, "updatedAt"=NOW() WHERE id=$1 AND status='running'`,
    [id, String(progress || '').slice(0, 300)],
  );
}

/**
 * The audit itself. `progress` is called with a plain sentence before each slow step so the
 * page can show where the run is.
 */
async function performAudit(userId, input, { progress = async () => {} } = {}) {
  const url = normaliseHttpUrl(input.url);
  const parsed = new URL(url);
  await checkSsrf(parsed.hostname);

  const model = await resolveModel(userId, input.modelId);
  const facts = input.facts || [];
  const requestedQueries = input.queries || [];

  await progress('Fetching the page as a crawler would…');
  const fetchResult = await fetchPage(url);
  const html = String(fetchResult.body || '');
  if (!html.trim()) {
    const err = new Error('The page returned no readable HTML.');
    err.status = 422;
    throw err;
  }

  const finalUrl = fetchResult.finalUrl || url;
  const host = hostOf(finalUrl);
  await progress('Reading robots.txt…');
  const technical = buildTechnical({ fetchResult, html, robotsFetch: await fetchRobots(finalUrl) });
  await progress('Rendering the page in a browser to compare with the raw HTML…');
  technical.js = await buildReadability(technical, finalUrl);
  delete technical.rawText;

  const schema = validateSchema(html);
  // The parsed blocks are useful for debugging but not for the report, and they can be
  // large; keep the report row small.
  delete schema.blocks;

  const brand = input.brand || brandFromTitle(technical.meta.title, host);

  let queries = requestedQueries;
  let querySource = 'user';
  let queryGenerationError = '';
  if (!queries.length) {
    await progress('Writing buyer questions from the page…');
    const generated = await generateQueries({
      url: finalUrl,
      title: technical.meta.title,
      description: technical.meta.description,
      headings: (technical.js.headings || []),
      brand,
      modelId: model,
    });
    queries = generated.queries;
    querySource = generated.source === 'model' ? 'generated' : 'template';
    queryGenerationError = generated.error || '';
  }

  const assistantList = await listAssistants(userId);
  const available = assistantList.filter((a) => a.available);
  const chosen = Array.isArray(input.assistants)
    ? available.filter((a) => input.assistants.includes(a.id))
    : available;
  const names = chosen.map((a) => a.label.split(' ')[0]).join(', ');

  const queryResults = [];
  for (let i = 0; i < queries.length; i += 1) {
    // Questions run one after another; within a question the assistants run in parallel
    // because they are different providers.
    // eslint-disable-next-line no-await-in-loop
    await progress(`Question ${i + 1} of ${queries.length}: searching${names ? ` and asking ${names}` : ''}…`);
    // eslint-disable-next-line no-await-in-loop
    const result = await runQuery({ query: queries[i], domain: host, brand, facts, assistants: chosen, userId });
    result.source = querySource;
    queryResults.push(result);
  }

  // Facts are checked against the assistants' own answers only, never against other sites'
  // search snippets.
  const answers = [];
  for (const q of queryResults) for (const a of q.assistants) if (a.score != null) answers.push(a.answer);
  const coverage = answers.length ? factCoverage(facts, answers) : [];

  const report = scoreReport({
    version: REPORT_VERSION,
    url,
    finalUrl,
    host,
    brand,
    model,
    assistantsAsked: chosen.map((a) => ({ id: a.id, label: a.label, model: a.model })),
    assistantsUnavailable: assistantList.filter((a) => !a.available).map((a) => ({ id: a.id, label: a.label, reason: a.reason })),
    auditedAt: new Date().toISOString(),
    querySource,
    queryGenerationError,
    technical,
    schema,
    queries: queryResults,
    facts: coverage,
    input,
  });
  return { report, finalUrl, title: technical.meta.title };
}

async function runInBackground(userId, id, input) {
  const started = Date.now();
  try {
    const { report, finalUrl, title } = await performAudit(userId, input, { progress: (p) => setProgress(id, p) });
    const name = input.name || String(title || '').trim() || hostOf(finalUrl) || finalUrl;
    await pool.query(
      `UPDATE ai_visibility_audits
          SET name=$3, url=$4, score=$5, summary=$6, report=$7, status='done', progress='', error='', "updatedAt"=NOW()
        WHERE id=$1 AND "userId"=$2`,
      [id, userId, name.slice(0, 120), finalUrl, report.scores.overall, report.summary, JSON.stringify(report)],
    );
    console.log(`[ai-visibility] audit ${id} done in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err) {
    console.error(`[ai-visibility] audit ${id} failed after ${Math.round((Date.now() - started) / 1000)}s:`, err.message);
    await pool.query(
      `UPDATE ai_visibility_audits SET status='failed', progress='', error=$3, "updatedAt"=NOW()
        WHERE id=$1 AND "userId"=$2`,
      [id, userId, String(err.message || 'The audit failed.').slice(0, 500)],
    ).catch(() => {});
  }
}

/**
 * Start an audit in the background. Checks that can fail fast (address, private network,
 * model choice, one run at a time) happen here so the person sees the error straight away;
 * the slow work runs after the response has been sent and the page polls the saved row.
 */
async function startAudit(userId, rawInput = {}) {
  const input = cleanInput(rawInput);
  const url = normaliseHttpUrl(input.url);
  await checkSsrf(new URL(url).hostname);
  await resolveModel(userId, input.modelId);

  const { rows: running } = await pool.query(
    `SELECT id FROM ai_visibility_audits
      WHERE "userId"=$1 AND status='running' AND "updatedAt" > NOW() - INTERVAL '20 minutes'
      LIMIT 1`,
    [userId],
  );
  if (running.length) {
    const err = new Error('An audit is already running. Wait for it to finish, then start the next one.');
    err.status = 409;
    err.auditId = running[0].id;
    throw err;
  }

  const name = input.name || hostOf(url) || url;
  const { rows } = await pool.query(
    `INSERT INTO ai_visibility_audits ("userId", name, url, score, summary, report, status, progress)
     VALUES ($1, $2, $3, 0, '', $4, 'running', 'Starting…')
     RETURNING *`,
    [userId, name.slice(0, 120), url, JSON.stringify({ version: REPORT_VERSION, input })],
  );
  const row = rows[0];
  setImmediate(() => { runInBackground(userId, row.id, { ...input, url }); });
  return rowToAudit(row);
}

function rowToAudit(row) {
  const report = parseJson(row.report, {});
  let status = row.status || 'done';
  let error = row.error || '';
  const updated = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
  if (status === 'running' && updated && Date.now() - updated > STALE_RUN_MS) {
    status = 'failed';
    error = error || 'The audit stopped before it finished (the server may have restarted). Run it again.';
  }
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    hostname: hostOf(row.url),
    score: Number(row.score),
    summary: row.summary || report.summary || '',
    status,
    progress: status === 'running' ? (row.progress || '') : '',
    error: status === 'failed' ? error : '',
    report,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listAudits(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, url, score, summary, status, progress, error, "createdAt", "updatedAt"
       FROM ai_visibility_audits
      WHERE "userId"=$1
      ORDER BY "createdAt" DESC
      LIMIT 80`,
    [userId],
  );
  return rows.map(rowToAudit);
}

async function getAudit(userId, id) {
  const { rows } = await pool.query(
    'SELECT * FROM ai_visibility_audits WHERE id=$1 AND "userId"=$2',
    [id, userId],
  );
  return rows[0] ? rowToAudit(rows[0]) : null;
}

async function deleteAudit(userId, id) {
  const { rowCount } = await pool.query(
    'DELETE FROM ai_visibility_audits WHERE id=$1 AND "userId"=$2',
    [id, userId],
  );
  return rowCount > 0;
}

function markdownFor(audit) {
  if (!audit) return '';
  return buildMarkdown(audit.report, { url: audit.url, createdAt: audit.createdAt });
}

module.exports = {
  MAX_QUERIES,
  MAX_FACTS,
  REPORT_VERSION,
  startAudit,
  performAudit,
  cleanInput,
  listAudits,
  getAudit,
  deleteAudit,
  markdownFor,
  rowToAudit,
  metaContent,
  countWords,
  normaliseList,
};
