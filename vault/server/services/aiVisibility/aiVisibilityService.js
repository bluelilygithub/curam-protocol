'use strict';

/**
 * AI Visibility audit orchestration + storage.
 *
 * One run:
 *   1. fetch the page as a crawler would (SSRF-safe, no JavaScript);
 *   2. fetch and parse robots.txt, then check the AI crawlers individually;
 *   3. render the page in Chromium and compare the readable content;
 *   4. validate JSON-LD entities;
 *   5. generate (or accept) buyer questions, run real search + a model answer for each;
 *   6. check citation/mention and the supplied key facts;
 *   7. score, write suggestions, save the report.
 *
 * Nothing here writes outside this module and its table.
 */

const { pool } = require('../../db');
const { fetchHtml, fetchDirect, htmlToText, extractTitle, decodeEntities, normaliseHttpUrl } = require('../htmlFetch');
const { checkSsrf } = require('../../utils/safeFetch');
const { getModelsForUser, getVaultModelsConfigForUser, pickTextModel, isNonTextModel } = require('../modelResolver');
const { parseRobots, auditRobots } = require('./robots');
const { validateSchema } = require('./schema');
const { renderPage } = require('./render');
const { generateQueries, runQuery, hostOf } = require('./queryAnalysis');
const { factCoverage } = require('./facts');
const { scoreReport } = require('./scoring');
const { buildMarkdown } = require('./markdown');

const MAX_QUERIES = 6;
const MAX_FACTS = 12;

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

function brandFromTitle(title, host) {
  const first = String(title || '').split(/\s*[|–—:·]\s*/)[0].trim();
  if (first && first.length <= 60) return first;
  return String(host || '').split('.')[0] || '';
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

async function runAudit(userId, input = {}) {
  const url = normaliseHttpUrl(input.url);
  const parsed = new URL(url);
  await checkSsrf(parsed.hostname);

  const model = await resolveModel(userId, input.modelId);
  const facts = normaliseList(input.facts, MAX_FACTS);
  const requestedQueries = normaliseList(input.queries, MAX_QUERIES);

  const fetchResult = await fetchHtml(url);
  const html = String(fetchResult.body || '');
  if (!html.trim()) {
    const err = new Error('The page returned no readable HTML.');
    err.status = 422;
    throw err;
  }

  const finalUrl = fetchResult.finalUrl || url;
  const host = hostOf(finalUrl);
  const technical = buildTechnical({ fetchResult, html, robotsFetch: await fetchRobots(finalUrl) });
  technical.js = await buildReadability(technical, finalUrl);
  delete technical.rawText;

  const schema = validateSchema(html);
  // The parsed blocks are useful for debugging but not for the report, and they can be
  // large; keep the report row small.
  delete schema.blocks;

  const brand = String(input.brand || '').trim() || brandFromTitle(technical.meta.title, host);

  let queries = requestedQueries;
  let querySource = 'user';
  let queryGenerationError = '';
  if (!queries.length) {
    const generated = await generateQueries({
      url: finalUrl,
      title: technical.meta.title,
      description: technical.meta.description,
      headings: (technical.js.headings || []),
      brand,
      modelId: model,
    });
    queries = generated.queries;
    querySource = 'generated';
    queryGenerationError = generated.error || '';
  }

  const queryResults = [];
  for (const query of queries) {
    // Sequential on purpose: search providers and models rate-limit, and the audit is a
    // single deliberate run, not a bulk job.
    // eslint-disable-next-line no-await-in-loop
    const result = await runQuery({ query, domain: host, brand, facts, modelId: model, userId });
    result.source = querySource;
    queryResults.push(result);
  }

  const answers = queryResults.map((q) => q.answer).filter(Boolean);
  const coverage = factCoverage(facts, answers);

  const report = scoreReport({
    version: 1,
    url,
    finalUrl,
    host,
    brand,
    model,
    auditedAt: new Date().toISOString(),
    querySource,
    queryGenerationError,
    technical,
    schema,
    queries: queryResults,
    facts: coverage,
  });

  const name = String(input.name || '').trim() || technical.meta.title.trim() || host || url;
  const { rows } = await pool.query(
    `INSERT INTO ai_visibility_audits ("userId", name, url, score, summary, report)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, name.slice(0, 120), finalUrl, report.scores.overall, report.summary, JSON.stringify(report)],
  );
  return rowToAudit(rows[0]);
}

function rowToAudit(row) {
  const report = parseJson(row.report, {});
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    hostname: hostOf(row.url),
    score: Number(row.score),
    summary: row.summary || report.summary || '',
    report,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listAudits(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, url, score, summary, "createdAt", "updatedAt"
       FROM ai_visibility_audits
      WHERE "userId"=$1
      ORDER BY "updatedAt" DESC
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
  runAudit,
  listAudits,
  getAudit,
  deleteAudit,
  markdownFor,
  rowToAudit,
  metaContent,
  countWords,
  normaliseList,
};
