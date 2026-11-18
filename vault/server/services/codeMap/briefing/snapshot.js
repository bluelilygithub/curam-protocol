'use strict';

// Gathers what the Code Map briefing needs (buildBriefing.js turns it into Markdown). Read only, no model calls, no network.
//   - the latest finished Code Map run (tools, sizes, scores, links, findings, structure)
//   - the changelog: the last 30 days, plus entries whose concerns are not "None noted."
//   - Ponytail: a 30-day summary for this admin, if the table exists (skipped quietly if not)
//   - outside services: configured YES/NO only. `configuredServices` reads `name in env && env[name] !== ''` and keeps a boolean; no value
//     is ever copied into a variable, the result or a log.
//   - package.json dependency names; each tool's purpose from the first line of its doc; the curated about/rules/building-blocks files;
//     the owner's notes (settings table, key code_map_briefing_notes).

const fs = require('fs');
const path = require('path');
const { VAULT_ROOT, curated, staleRuleSources } = require('./sources');

const NOTES_KEY = 'code_map_briefing_notes';

// Service -> the variables that switch it on. `all: true` = every one must be set. A test checks each name is documented in
// docs/env-vars.md or read by server code.
const SERVICES = [
  { service: 'Anthropic', vars: ['ANTHROPIC_API_KEY'], usedFor: 'Claude, the primary model (chat, generation, marking, agents).' },
  { service: 'Google Gemini', vars: ['GEMINI_API_KEY'], usedFor: 'Gemini models and the embeddings behind RAG search.' },
  { service: 'DeepSeek', vars: ['DEEPSEEK_API_KEY'], usedFor: 'Optional DeepSeek model in the model list.' },
  { service: 'Google sign-in (OAuth)', vars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'], all: true, usedFor: 'Gmail, Calendar, Drive and Search Console connections.' },
  { service: 'Email sending', vars: ['MAIL_CHANNEL_API_KEY', 'SMTP_HOST'], usedFor: 'Password resets, invites, reminders and digests.' },
  { service: 'Web search', vars: ['SERPER_SEARCH_API_KEY', 'SEARCH_API_KEY'], usedFor: 'Web search for chat, research and the SERP Tracker.' },
  { service: 'DataForSEO', vars: ['DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'], all: true, usedFor: 'SERP Tracker rankings.' },
  { service: 'Perplexity', vars: ['PERPLEXITY_API_KEY'], usedFor: 'AI Visibility: one of the assistants questions are put to.' },
  { service: 'Replicate', vars: ['REPLICATE_API_TOKEN'], usedFor: 'Video clips, picture upscaling and background removal, audio tools.' },
  { service: 'fal', vars: ['FAL_API_KEY'], usedFor: 'Graphics, video fallback and recipe photos.' },
  { service: 'Finnhub', vars: ['FINNHUB_API_KEY'], usedFor: 'Shares: US quotes and company news.' },
  { service: 'Alpha Vantage', vars: ['ALPHA_VANTAGE_API_KEY'], usedFor: 'Shares: ASX quotes.' },
  { service: 'DomScan', vars: ['DOMSCAN_API_KEY'], usedFor: 'Domain and brand availability.' },
  { service: 'Rainforest', vars: ['RAINFOREST_API_KEY'], usedFor: 'Product Scout: Amazon search and product data.' },
  { service: 'PageSpeed Insights', vars: ['PAGESPEED_API_KEY'], usedFor: 'Lighthouse and page speed checks.' },
  { service: 'Maps and routing', vars: ['MAPTILER_API_KEY', 'ORS_API_KEY'], usedFor: 'Route Tracer maps and routes.' },
  { service: 'Atlas of Living Australia', vars: ['ALA_API_KEY'], usedFor: 'Garden Planner plant photos.' },
  { service: 'Reddit', vars: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'], all: true, usedFor: 'Topic Research: Reddit as a source.' },
  { service: 'GitHub', vars: ['GITHUB_TOKEN'], usedFor: 'Font Customizer licence lookups (higher rate limit).' },
  { service: 'Sentry', vars: ['SENTRY_DSN'], usedFor: 'Error tracking.' },
  { service: 'Token encryption', vars: ['ENCRYPTION_KEY'], usedFor: 'Encrypts stored OAuth tokens at rest.' },
  { service: 'Railway', vars: ['RAILWAY_GIT_COMMIT_SHA'], usedFor: 'Set by Railway on deploy: the commit being run.' },
];

/** [{ service, configured, usedFor }]: YES/NO only. */
function configuredServices(env = process.env) {
  const isSet = (name) => Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined && env[name] !== '';
  return SERVICES.map((x) => ({ service: x.service, configured: x.all ? x.vars.every(isSet) : x.vars.some(isSet), usedFor: x.usedFor }));
}

function packageNames(root = VAULT_ROOT) {
  try { return Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies || {}); } catch { return []; }
}

// A doc's opening lines mix what the tool does with where its code lives ("Real double-entry bookkeeping for a sole trader. Route:
// server/routes/finance.js. Client: ..."). The purpose keeps the descriptive sentences of the first prose lines and drops the ones that are
// paths, routes, flags, status notes or commands.
const NOT_PROSE = /^(#|\||```|<|>|[-*]{3,}$|[-*+] |\d+\. |status:)/i;
const PATHISH = /(^|[\s(])(\/[a-z][\w/-]*|[\w.-]+\/[\w./-]+|npm run|node \S+\.js)|^(route|routes|client|server|page|pages|api|table|tables|flag|nav|tests?|docs?|file|files|also|added|renamed|built|moved|see|design set)\b\s*[:\d(]/i;
const sentencesOf = (line) => line.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z"(])/);
function purposeFrom(text, max = 200) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !NOT_PROSE.test(l)).slice(0, 3);
  for (const line of lines) {
    const kept = sentencesOf(line.replace(/[*_`]/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')).filter((s) => !PATHISH.test(s) && /[a-z]{3,} [a-z]{3,}/i.test(s));
    let out = '';
    for (const s of kept) { if ((out ? `${out} ${s}` : s).length > max) break; out = out ? `${out} ${s}` : s; }
    if (!out && kept[0]) out = `${kept[0].slice(0, max).replace(/\s+\S*$/, '')}…`;
    if (out.length >= 25) return out;
  }
  return '';
}

const kebab = (id) => String(id).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** tool id -> one line, from the curated tool-purposes.md ("- `id` — purpose"). */
function curatedPurposes() {
  const out = {};
  let text = '';
  try { text = fs.readFileSync(path.join(__dirname, 'tool-purposes.md'), 'utf8'); } catch { return out; }
  for (const m of text.matchAll(/^- `([\w-]+)` — (.+)$/gm)) out[m[1]] = m[2].trim();
  return out;
}

/**
 * What each tool is for: the curated line in tool-purposes.md, else the descriptive sentences of the first prose lines of docs/<tool>.md
 * (the same doc the Code Map's Docs rule looks for), else nothing (the briefing then uses the menu name).
 */
function toolPurposes(tools, root = VAULT_ROOT) {
  let alias = {};
  try { alias = require('../rules').DOC_ALIAS || {}; } catch { /* older rules.js: kebab names only */ }
  const out = {};
  const curatedLines = curatedPurposes();
  for (const t of tools || []) {
    if (curatedLines[t.id]) { out[t.id] = curatedLines[t.id]; continue; }
    const name = Object.prototype.hasOwnProperty.call(alias, t.id) ? alias[t.id] : `${kebab(t.id)}.md`;
    if (!name) continue;
    let text;
    try { text = fs.readFileSync(path.join(root, 'docs', name), 'utf8'); } catch { continue; }
    const purpose = purposeFrom(text);
    if (purpose) out[t.id] = purpose;
  }
  return out;
}

function cronJobCount(root = VAULT_ROOT) {
  try { return fs.readdirSync(path.join(root, 'server/cron')).filter((f) => f.endsWith('.js') && !f.includes('.test.')).length; } catch { return 0; }
}

async function changelogRows(pool) {
  const { rows } = await pool.query(
    `SELECT "committedAt", area, subject, concerns FROM changelog_entries
      WHERE subject NOT ILIKE 'Changelog:%'
        AND ("committedAt" >= NOW() - INTERVAL '30 days' OR (concerns <> '' AND concerns NOT ILIKE 'None noted%'))
      ORDER BY "committedAt" DESC LIMIT 400`);
  return rows;
}

async function ponytailSummary(pool, userId) {
  try {
    const exists = (await pool.query(`SELECT to_regclass('ponytail_tasks') AS t`)).rows[0].t;
    if (!exists) return null;
    const r = (await pool.query(
      `SELECT COUNT(*) AS tasks, COALESCE(SUM(cost),0) AS cost, AVG(reuse) AS "avgReuse"
         FROM ponytail_tasks WHERE "userId" = $1 AND started >= NOW() - INTERVAL '30 days'`, [userId])).rows[0];
    return { tasks: Number(r.tasks), cost: Number(r.cost), avgReuse: r.avgReuse == null ? null : Number(r.avgReuse) };
  } catch { return null; }
}

async function readNotes(pool, userId) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE "userId"=$1 AND key=$2', [userId, NOTES_KEY]);
  return rows[0]?.value || '';
}

/** Everything buildBriefing needs. `latestRun` is jobs.latest() (null before the first run). */
async function gatherSnapshot({ pool, userId, latestRun, env = process.env, root = VAULT_ROOT, now = new Date() }) {
  const run = latestRun?.result || null;
  const [changelog, ponytail, notes] = await Promise.all([changelogRows(pool), ponytailSummary(pool, userId), readNotes(pool, userId)]);
  return {
    generatedAt: now.toISOString(),
    commitHint: latestRun?.commitHint || env.RAILWAY_GIT_COMMIT_SHA || null,
    runFinishedAt: latestRun?.finishedAt || null,
    run,
    curated: curated(),
    purposes: toolPurposes(run?.tools, root),
    packages: packageNames(root),
    services: configuredServices(env),
    changelog,
    ponytail,
    notes,
    cronJobs: cronJobCount(root),
    rulesStale: staleRuleSources(root),
  };
}

module.exports = { gatherSnapshot, configuredServices, toolPurposes, curatedPurposes, purposeFrom, packageNames, readNotes, SERVICES, NOTES_KEY };
