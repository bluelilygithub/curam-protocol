'use strict';

const cron = require('node-cron');
const { pool } = require('../db');
const { fetchArticlesForTopic, DEFAULT_SOURCE_GROUPS, flattenSourceGroups, checkSourceHealth } = require('../services/newsAggregationService');
const { analyseTopicArticles } = require('../services/newsAnalysisService');
const { logUsage } = require('../utils/logUsage');
const { reportNewsDigestRun, getPrimaryAdminUserId, capture, makeFingerprint } = require('../services/SuggestionService');

let cronTask = null;

// Approximate cost per million tokens by model tier
function estimateCost(inputTokens, outputTokens, model) {
  let inputRate, outputRate;
  if (model && model.startsWith('gemini')) {
    inputRate  = 0.10 / 1_000_000;
    outputRate = 0.40 / 1_000_000;
  } else if (model && model.includes('haiku')) {
    inputRate  = 0.80 / 1_000_000;
    outputRate = 4.00 / 1_000_000;
  } else {
    // sonnet or unknown — use sonnet rates
    inputRate  = 3.00 / 1_000_000;
    outputRate = 15.00 / 1_000_000;
  }
  return inputTokens * inputRate + outputTokens * outputRate;
}

// Schedule + sources are workspace-global, stored on the primary admin's settings row — see
// the same note in server/routes/newsDigest.js (settings' real PK is composite ("userId", key),
// a bare "WHERE key=..." here previously matched every user's row indiscriminately).
async function getScheduleSettings() {
  try {
    const adminId = await getPrimaryAdminUserId();
    if (!adminId) return { time: '07:00', days: [0, 1, 2, 3, 4, 5, 6] };
    const { rows } = await pool.query(
      `SELECT key, value FROM settings WHERE "userId"=$1 AND key = ANY($2)`,
      [adminId, ['news_digest_time', 'news_digest_days']]
    );
    const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
    return {
      time: map.news_digest_time || '07:00',
      days: map.news_digest_days ? JSON.parse(map.news_digest_days) : [0, 1, 2, 3, 4, 5, 6],
    };
  } catch {
    return { time: '07:00', days: [0, 1, 2, 3, 4, 5, 6] };
  }
}

// Reads the raw (grouped) source setting, admin-scoped, falling back to the code defaults if
// unset or unparseable. Shared by getActiveSources (all-groups flat list) and
// getSourcesForTopic (a topic's own group subset), so both read the setting the same way.
async function getSourceGroupsSetting() {
  try {
    const adminId = await getPrimaryAdminUserId();
    if (!adminId) return DEFAULT_SOURCE_GROUPS;
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key='news_digest_sources'`,
      [adminId]
    );
    if (!rows.length) return DEFAULT_SOURCE_GROUPS;
    return JSON.parse(rows[0].value);
  } catch {
    return DEFAULT_SOURCE_GROUPS;
  }
}

// Resolves the actual flat source list to fetch from — every enabled source across every
// group. Previously generateDigestForUser never called this at all and always used the
// hardcoded defaults regardless of what Settings showed — the toggles were a no-op.
async function getActiveSources() {
  return flattenSourceGroups(await getSourceGroupsSetting());
}

// Resolves the flat source list for ONE topic, honoring its optional sourceGroups pin
// (news_topics."sourceGroups", an array of group names). Google News is always included
// alongside a group pin — it's a keyword search, not a fixed feed tied to any one group, and
// excluding it would remove the topic's only source that actually reflects its own keywords
// rather than a fixed group's general coverage. A topic with no pin (null/empty) gets every
// enabled source, unchanged from before — this is opt-in, not a behavior change for existing
// topics that never set it.
async function getSourcesForTopic(sourceGroups) {
  const groups = await getSourceGroupsSetting();
  if (!Array.isArray(sourceGroups) || !sourceGroups.length) return flattenSourceGroups(groups);

  const picked = {};
  for (const name of sourceGroups) if (groups[name]) picked[name] = groups[name];
  const flat = flattenSourceGroups(picked);
  const hasGoogleNews = flat.some(s => s.url === '__google_news__');
  if (!hasGoogleNews) {
    const gn = flattenSourceGroups(groups).find(s => s.url === '__google_news__');
    if (gn) flat.push(gn);
  }
  return flat;
}

async function getWorkspaceTimezone() {
  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE s.key = 'user_timezone' AND u."isAdmin" = TRUE
       ORDER BY u.id ASC LIMIT 1`
    );
    return rows[0]?.value?.trim() || 'Australia/Sydney';
  } catch {
    return 'Australia/Sydney';
  }
}

async function scheduleDigestCron() {
  if (cronTask) { cronTask.stop(); cronTask = null; }
  const { time, days } = await getScheduleSettings();
  const tz = await getWorkspaceTimezone();
  const [hour, minute] = time.split(':').map(Number);
  const daysPattern = days.length === 7 ? '*' : days.join(',');
  const schedule = `${minute} ${hour} * * ${daysPattern}`;
  cronTask = cron.schedule(schedule, runDailyDigest, { timezone: tz });
  console.log(`[news-cron] Scheduled daily digest at ${time} on days [${days}] (tz: ${tz})`);
}

/**
 * Fetch the last 6 days of unbiased summaries + user commentary for a topic.
 * Used to give the AI rolling context so it can note trends and shifts.
 */
async function fetchTopicContext(userId, topicId, beforeDate) {
  try {
    const { rows } = await pool.query(
      `SELECT
         nd.date::text                                     AS date,
         ndt.analysis->'unbiased'->>'summary'             AS "unbiasedSummary",
         ndc.commentary
       FROM news_digest_topics ndt
       JOIN news_digests nd ON nd.id = ndt."digestId"
       LEFT JOIN news_digest_context ndc
         ON ndc."topicId" = ndt."topicId"
         AND ndc."userId" = nd."userId"
         AND ndc.date = nd.date
       WHERE ndt."topicId" = $1
         AND nd."userId"   = $2
         AND nd.date >= $3::date - INTERVAL '6 days'
         AND nd.date <  $3::date
       ORDER BY nd.date DESC`,
      [topicId, userId, beforeDate]
    );
    return rows;
  } catch {
    return [];
  }
}

/**
 * Generate the news digest for a specific user and date.
 * @param {number}  userId
 * @param {string}  dateStr - YYYY-MM-DD
 * @param {boolean} force   - if true, delete and re-run existing topic analyses
 */
async function generateDigestForUser(userId, dateStr, force = false) {
  // Get all active topics for this user
  const { rows: topics } = await pool.query(
    `SELECT id, title, keywords, "sourceGroups" FROM news_topics WHERE "userId"=$1 AND active=true ORDER BY "sortOrder" ASC`,
    [userId]
  );

  if (!topics.length) return;

  // Upsert digest row
  const { rows: digestRows } = await pool.query(
    `INSERT INTO news_digests ("userId", date) VALUES ($1, $2)
     ON CONFLICT ("userId", date) DO UPDATE SET "generatedAt"=NOW()
     RETURNING id`,
    [userId, dateStr]
  );
  const digestId = digestRows[0].id;

  // Process each topic (sequentially to avoid API rate limits)
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastModel = null;
  const runMeta = { emptyTopics: [], failedTopics: [], topicsTotal: topics.length };

  for (const topic of topics) {
    // Skip if already done — unless force-regenerating
    const { rows: existing } = await pool.query(
      `SELECT id FROM news_digest_topics WHERE "digestId"=$1 AND "topicId"=$2`,
      [digestId, topic.id]
    );
    if (existing.length) {
      if (!force) continue;
      await pool.query(
        `DELETE FROM news_digest_topics WHERE "digestId"=$1 AND "topicId"=$2`,
        [digestId, topic.id]
      );
    }

    console.log(`[news-cron] Analysing topic "${topic.title}" for user ${userId}`);

    try {
      const topicSources = await getSourcesForTopic(topic.sourceGroups);
      const articles = await fetchArticlesForTopic(topic.title, topic.keywords, 20, topicSources);
      if (!articles.length) {
        runMeta.emptyTopics.push({ id: topic.id, title: topic.title });
      }
      const context  = await fetchTopicContext(userId, topic.id, dateStr);
      const { analysis, usage } = await analyseTopicArticles(topic.title, articles, context, userId);

      totalInputTokens  += usage.inputTokens  || 0;
      totalOutputTokens += usage.outputTokens || 0;
      if (usage.model) lastModel = usage.model;
      logUsage({
        userId,
        model: usage.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        feature: 'news_digest',
      });

      await pool.query(
        `INSERT INTO news_digest_topics ("digestId", "topicId", articles, analysis)
         VALUES ($1, $2, $3, $4)`,
        [digestId, topic.id, JSON.stringify(articles), JSON.stringify(analysis)]
      );
    } catch (err) {
      console.error(`[news-cron] Failed topic "${topic.title}":`, err.message);
      runMeta.failedTopics.push({ id: topic.id, title: topic.title, error: err.message });
    }
  }

  // Store token usage and approximate cost
  const approxCostUsd = estimateCost(totalInputTokens, totalOutputTokens, lastModel);
  await pool.query(
    `UPDATE news_digests SET "totalTokens"=$1, "approxCostUsd"=$2 WHERE id=$3`,
    [totalInputTokens + totalOutputTokens, approxCostUsd, digestId]
  );

  runMeta.approxCostUsd = approxCostUsd;
  await reportNewsDigestRun(userId, dateStr, runMeta);

  console.log(`[news-cron] Digest complete for user ${userId} on ${dateStr} — ${totalInputTokens + totalOutputTokens} tokens, ~$${approxCostUsd.toFixed(4)}`);
}

/**
 * Run digest generation for all users who have active topics.
 */
async function runDailyDigest() {
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[news-cron] Starting daily digest for ${today}`);

  try {
    // Source health is workspace-global (one shared list), so check once per run rather than
    // once per user/topic — a dead feed otherwise just looks identical to "no news today" for
    // every topic that happens to lean on it (see docs/CLAUDE.md's suggestion-inbox rule; this
    // is the fix for the Reuters-shaped gap: nothing previously surfaced a feed dying at all).
    const activeSources = await getActiveSources();
    const health = await checkSourceHealth(activeSources);
    const deadSources = health.filter(h => !h.ok);
    if (deadSources.length) {
      const adminId = await getPrimaryAdminUserId();
      if (adminId) {
        for (const s of deadSources) {
          await capture({
            userId: adminId,
            source: 'newsDigestCron',
            category: 'alert',
            // No date in the fingerprint — this is a "still broken" condition, not a
            // per-day variance like the empty-topic alerts, so it stays as one open
            // suggestion that refreshes in place until the feed is fixed or removed.
            fingerprint: makeFingerprint('newsDigestCron', `source-dead:${s.name}`),
            title: `News Digest: source "${s.name}" appears dead`,
            body: `${s.url} — ${s.error}. Remove or replace it in Settings → News Digest → Sources.`,
            context: `date=${today}`,
          });
        }
      }
      console.warn(`[news-cron] ${deadSources.length} dead source(s): ${deadSources.map(s => s.name).join(', ')}`);
    }

    const { rows: users } = await pool.query(
      `SELECT DISTINCT "userId" FROM news_topics WHERE active=true`
    );

    for (const { userId } of users) {
      await generateDigestForUser(userId, today);
    }
  } catch (err) {
    console.error('[news-cron] Daily digest run failed:', err.message);
    const adminId = await getPrimaryAdminUserId();
    if (adminId) {
      await capture({
        userId: adminId,
        source: 'newsDigestCron',
        category: 'alert',
        title: 'News Digest cron run failed',
        body: err.message,
        context: `date=${today}`,
      });
    }
  }
}

/**
 * Start the cron job. Call this once from server/index.js.
 * Reads schedule from DB settings so it picks up any user configuration.
 */
function startNewsDigestCron() {
  scheduleDigestCron().catch(err => console.error('[news-cron] Schedule error:', err.message));
}

module.exports = { startNewsDigestCron, generateDigestForUser, runDailyDigest, scheduleDigestCron, getActiveSources, getSourceGroupsSetting };
