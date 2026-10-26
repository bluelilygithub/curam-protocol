'use strict';

// Topic Research: what happens to a search's articles after they are found. The database side of reading pages, grouping stories and ranking.
//
//   analyseRun   first pass: group and rank on titles and snippets; read the pages of the best few (extract.js); second pass: group and rank
//                again with the page text, then save every article's story, score, breakdown and Original flag, plus the weights used and
//                the topic's heat on the run;
//   rescoreRun   rank again from what is already stored (no fetching, and no re-reading), after the owner changes a weight or an outlet's
//                weight. Articles of an older search that were never grouped are grouped first.
//
// Nothing here sends a page's text anywhere: it is loaded into memory for grouping and not returned. See docs/topic-research.md.

const { clusterArticles } = require('./cluster');
const { scoreArticles, topicHeat, fingerprint } = require('./score');
const { loadSettings } = require('./settings');
const { loadSourceWeights, toMap } = require('./sourceWeights');
const { NOOP } = require('./progress');

const READ_LIMIT = Math.max(0, Number(process.env.TOPIC_RESEARCH_EXTRACT_LIMIT) || 12);
const READ_BUDGET_MS = Math.max(1000, Number(process.env.TOPIC_RESEARCH_EXTRACT_BUDGET_MS) || 25000);
const FRESH_READ_MS = 7 * 24 * 3600 * 1000; // a page that was read (or was not an article) is not fetched again for a week
const FRESH_FAIL_MS = 24 * 3600 * 1000; // one that refused, errored or was off limits is not asked again for a day

const json = (v, fallback) => {
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
  return v ?? fallback;
};

/** The weights and settings that decide scores, as scoreArticles wants them. */
async function loadScoringConfig(pool, userId, now = Date.now()) {
  const settings = await loadSettings(pool, userId);
  const sourceWeights = toMap(await loadSourceWeights(pool, userId));
  return { weights: settings.scoringWeights, halfLifeHours: settings.halfLifeHours, sourceWeights, now };
}

async function loadRunArticles(pool, userId, runId) {
  const { rows } = await pool.query(
    `SELECT ra.id AS "raId", ra."clusterId", ra."signalsJson",
            a.id AS "articleId", a.url, a.title, a.domain, a."publishedAt", a.snippet, a."extractedText", a."extractStatus", a."extractedAt", a."pageKind"
       FROM topic_research_run_articles ra JOIN topic_research_articles a ON a.id = ra."articleId"
      WHERE ra."runId" = $1 AND a."userId" = $2 ORDER BY a.id`,
    [runId, userId],
  );
  return rows.map((r) => ({
    id: r.raId, articleId: r.articleId, url: r.url, title: r.title, domain: r.domain, snippet: r.snippet || '',
    publishedAt: r.publishedAt ? new Date(r.publishedAt) : null, text: r.extractedText || '',
    extractStatus: r.extractStatus || null, extractedAt: r.extractedAt ? new Date(r.extractedAt) : null, pageKind: r.pageKind || null,
    signals: json(r.signalsJson, {}), clusterId: r.clusterId,
  }));
}

/** True when a page has not been tried lately (or its text is not stored), so reading it is worth a request. */
function needsReading(a, nowMs) {
  if (!a.extractStatus || !a.extractedAt) return true;
  const age = nowMs - a.extractedAt.getTime();
  if (['ok', 'thin', 'not-html'].includes(a.extractStatus)) return age > FRESH_READ_MS || (a.extractStatus === 'ok' && !a.text);
  return age > FRESH_FAIL_MS;
}

/** Group the articles into stories, score them, and number the stories 1.. from the best down. Returns what to save. */
function analyse(articles, config, previousHeat) {
  const { assign } = clusterArticles(articles);
  const grouped = articles.map((a) => ({ ...a, clusterId: assign.get(a.id) }));
  return rank(grouped, config, previousHeat);
}

/** Score articles that already have a story number, renumber the stories by their best score, find the Original and the heat. */
function rank(articles, config, previousHeat) {
  const { scores, clusters, used } = scoreArticles(articles, config);
  const renumber = new Map(clusters.map((c, i) => [c.clusterId, i + 1]));
  const originals = new Set(clusters.map((c) => c.originalId).filter((id) => id != null));
  const rows = articles.map((a) => ({
    id: a.id, clusterId: renumber.get(a.clusterId), score: scores.get(a.id).score, breakdown: scores.get(a.id).breakdown, isOriginal: originals.has(a.id),
  }));
  const heat = topicHeat(articles.map((a) => ({ ...a, clusterId: renumber.get(a.clusterId) })), { now: config.now, previous: previousHeat });
  return { rows, stories: clusters.length, used, heat, scores };
}

async function saveAnalysis(pool, userId, runId, result) {
  const { rows, used, heat } = result;
  if (rows.length) {
    await pool.query(
      `UPDATE topic_research_run_articles ra
          SET "clusterId" = v.cluster, score = v.score, "isOriginal" = v.original, "breakdownJson" = v.breakdown::jsonb
         FROM unnest($1::int[], $2::int[], $3::real[], $4::bool[], $5::text[]) AS v(id, cluster, score, original, breakdown)
        WHERE ra.id = v.id AND ra."runId" = $6`,
      [rows.map((r) => r.id), rows.map((r) => r.clusterId), rows.map((r) => r.score), rows.map((r) => r.isOriginal), rows.map((r) => JSON.stringify(r.breakdown)), runId],
    );
  }
  await pool.query(`UPDATE topic_research_runs SET "weightsJson" = $1, "heatJson" = $2 WHERE id = $3 AND "userId" = $4`, [JSON.stringify(used), JSON.stringify(heat), runId, userId]);
}

async function previousHeatOf(pool, userId, topicId, runId) {
  const { rows } = await pool.query(
    `SELECT "heatJson" FROM topic_research_runs WHERE "topicId" = $1 AND "userId" = $2 AND id <> $3 AND "heatJson" IS NOT NULL ORDER BY id DESC LIMIT 1`,
    [topicId, userId, runId],
  );
  const h = rows[0] && json(rows[0].heatJson, null);
  return h && Number.isFinite(Number(h.value)) ? Number(h.value) : null;
}

async function saveReads(pool, userId, reads) {
  for (const r of reads) {
    if (r.status === 'skipped') continue; // out of time: try again next search
    // eslint-disable-next-line no-await-in-loop
    await pool.query(
      `UPDATE topic_research_articles
          SET "extractedText" = $1, "wordCount" = $2, "extractStatus" = $3, "extractedAt" = NOW(), "publishedAt" = COALESCE("publishedAt", $4),
              "pageKind" = COALESCE($7, "pageKind")
        WHERE id = $5 AND "userId" = $6`,
      [r.status === 'ok' ? r.text : null, r.status === 'ok' ? r.wordCount : null, r.status, r.published || null, r.articleId, userId, r.pageKind || null],
    );
  }
}

/**
 * @param extractor { readPages(candidates, { budgetMs }) } (extract.js); null skips reading (used when none is configured)
 * @returns {{ stories, read: { counts, tried }, heat, used }}
 */
async function analyseRun({ pool, userId, runId, topic, extractor, limit = READ_LIMIT, budgetMs = READ_BUDGET_MS, now = Date.now, report = NOOP }) {
  const config = { ...(await loadScoringConfig(pool, userId, now())), now: now(), keyword: topic?.keyword };
  const previous = await previousHeatOf(pool, userId, topic.id, runId);

  let articles = await loadRunArticles(pool, userId, runId);
  const counts = {};
  let tried = 0;
  if (extractor && limit > 0 && articles.length) {
    const first = analyse(articles, config, previous);
    const order = [...articles].sort((a, b) => first.scores.get(b.id).score - first.scores.get(a.id).score || a.id - b.id);
    const picks = order.filter((a) => needsReading(a, now())).slice(0, limit);
    let reads = [];
    if (picks.length) report.start('read', `0 of ${picks.length} pages read`);
    try {
      if (picks.length) reads = await extractor.readPages(picks.map((a) => ({ id: a.id, url: a.url, publishedAt: a.publishedAt })), { budgetMs, onEach: (done, of) => report.detail('read', `${done} of ${of} pages read`) });
    } catch { counts.error = picks.length; /* the reader fell over: rank on headlines and snippets alone */ }
    if (picks.length) report.done('read', `${picks.length} page${picks.length === 1 ? '' : 's'} tried`);
    const byId = new Map(picks.map((a) => [a.id, a]));
    const withIds = reads.map((r) => ({ ...r, articleId: byId.get(r.id).articleId }));
    await saveReads(pool, userId, withIds);
    for (const r of reads) counts[r.status] = (counts[r.status] || 0) + 1;
    tried = reads.length;
    if (reads.length) articles = await loadRunArticles(pool, userId, runId);
  }
  if (!tried) report.done('read', 'Nothing new to read');
  report.start('rank', 'Grouping articles into stories');
  const result = analyse(articles, config, previous);
  await saveAnalysis(pool, userId, runId, result);
  report.done('rank', `${result.stories} stor${result.stories === 1 ? 'y' : 'ies'}`);
  return { stories: result.stories, read: { counts, tried }, heat: result.heat, used: result.used };
}

/** Rank a stored run again with the settings as they are now. Groups the articles first if the run was never grouped. */
async function rescoreRun({ pool, userId, runId, topic, now = Date.now }) {
  const config = { ...(await loadScoringConfig(pool, userId, now())), now: now(), keyword: topic?.keyword };
  const articles = await loadRunArticles(pool, userId, runId);
  const previous = topic ? await previousHeatOf(pool, userId, topic.id, runId) : null;
  const grouped = articles.length > 0 && articles.every((a) => a.clusterId != null);
  const result = grouped ? rank(articles.map((a) => ({ ...a, clusterId: a.clusterId })), config, previous) : analyse(articles, config, previous);
  await saveAnalysis(pool, userId, runId, result);
  return { stories: result.stories, heat: result.heat, used: result.used };
}

/** True when a run's stored scores were made with different settings from the ones in force now (or were never made). */
async function isStale(pool, userId, run) {
  const config = await loadScoringConfig(pool, userId);
  const used = json(run.weightsJson, null);
  return !used || used.fingerprint !== fingerprint(config);
}

module.exports = { analyseRun, rescoreRun, isStale, loadScoringConfig, loadRunArticles, needsReading, analyse, rank, READ_LIMIT, READ_BUDGET_MS };
