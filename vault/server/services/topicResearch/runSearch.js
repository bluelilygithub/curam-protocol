'use strict';

// Topic Research: one whole search of one topic, the same whether a person pressed the button or the watchlist job did it.
//   lock (never two searches of one topic at once) -> settings -> this month's spend (paid sources pause when the limit is reached)
//   -> build the sources -> ask them (runCollect) -> read the best pages, group, rank (analyseRun).
// A fault while reading or ranking never loses the search: the articles are already saved, the search just comes back unranked.
// Everything outside is injectable so tests need no network or database. See docs/topic-research.md.

const { getLogger } = require('../../middleware/requestContext');
const { loadSettings } = require('./settings');
const { runCollect } = require('./collect');
const { monthSpend } = require('./spend');
const { progress } = require('./progress');

// the steps a person sees while a search runs (the notes are recorded as each really happens: progress.js)
const SEARCH_STEPS = [
  { id: 'sources', label: 'Asking your sources' },
  { id: 'save', label: 'Saving what they found' },
  { id: 'read', label: 'Reading the best pages' },
  { id: 'rank', label: 'Grouping stories and ranking' },
];

// one page reader for the whole server, so its robots.txt answers and its per-site spacing last from one search to the next
let sharedExtractor = null;
const defaultExtractor = () => {
  if (!sharedExtractor) sharedExtractor = require('./extract').createExtractor();
  return sharedExtractor;
};

const running = new Set(); // "userId:topicId" with a search in progress, shared by the page and the watchlist job

const isRunning = (userId, topicId) => running.has(`${userId}:${topicId}`);

/** The sources for this person: { sources, status }. Accepts a plain list from an injected builder (tests do). */
async function sourcesFor(settings, { buildSources = (s, d) => require('./sources').buildSources(s, d), budgetOver = false } = {}) {
  const built = await buildSources(settings, { budgetOver });
  const list = Array.isArray(built) ? built : (built.sources || []);
  const status = Array.isArray(built) ? list.map((s) => ({ id: s.id || s.name, label: s.label || s.name, enabled: true, reason: null })) : (built.status || []);
  return { sources: list, status };
}

/**
 * @returns {{ id, status, errors, count, sources, extras, analysis, spend }}
 * @throws an error with status 409 when this topic is already being searched
 */
async function searchTopic({ pool, userId, topic, days, refresh = false, now = Date.now, buildSources, analyse, log, opId }) {
  const key = `${userId}:${topic.id}`;
  if (running.has(key)) { const e = new Error('A search for this topic is already running.'); e.status = 409; throw e; }
  running.add(key);
  const report = progress.begin(userId, opId, SEARCH_STEPS);
  try {
    const settings = await loadSettings(pool, userId);
    const spend = await monthSpend(pool, userId, settings.monthlyBudgetUsd, { now });
    const { sources } = await sourcesFor(settings, { buildSources, budgetOver: spend.over });
    const extra = Array.isArray(topic.extraQueries) ? topic.extraQueries : [];
    const out = await runCollect({ pool, userId, topic, sources, days, refresh, now, report, queries: [topic.keyword, ...extra] });
    let analysis = null;
    try {
      const run = analyse || ((args) => require('./analyse').analyseRun({ ...args, extractor: defaultExtractor() }));
      const a = await run({ pool, userId, runId: out.runId, topic, now, report });
      analysis = a ? { stories: a.stories, read: a.read, heat: a.heat } : null;
    } catch (err) { (log || ((e) => getLogger().error({ err: e }, 'topic research analysis failed')))(err); }
    return { id: out.runId, status: out.status, errors: out.errors, count: out.count, sources: out.sources, extras: out.extras, analysis, spend };
  } finally { report.finish(); running.delete(key); }
}

module.exports = { searchTopic, sourcesFor, isRunning, running, defaultExtractor, SEARCH_STEPS };
