'use strict';

// Topic Research, two background jobs:
//
//   refresh   every 15 minutes: search each WATCHED topic that is due (its last search started more than its refresh interval ago, or it has
//             never been searched). At most 5 topics a time, one after another; a topic already being searched (by the page or the previous
//             tick) is skipped; a member who has lost the feature is skipped; scheduled searches may use the 24-hour saved answers, so they
//             never pay twice for one answer; a paused paid source (monthly limit) just means the free sources are refreshed. A topic whose
//             last three searches all failed raises ONE alert in the Suggestions inbox (once per run of failures).
//   purge     daily 03:30: clear stored page text older than 30 days, and old saved search answers. Sends nothing.
//
// The refresh calls other services (feeds, news, search), so like the other such jobs it is started only where external jobs are allowed
// (server/index.js, not under DISABLE_EXTERNAL_CRON). The purge sends nothing and runs everywhere.
// `runDueTopics` and `purgeOld` take everything they need as arguments so tests need no database or network. See docs/topic-research.md.

const cron = require('node-cron');

const MAX_PER_TICK = 5;
const FAILURES_BEFORE_ALERT = 3;
const TEXT_KEEP_DAYS = 30;
const CACHE_KEEP_DAYS = 7;
const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Watched topics that are due now, longest-waiting first (never searched = first). */
async function findDue(pool, nowMs, max) {
  const { rows } = await pool.query(
    `SELECT t.*, (SELECT MAX(r."startedAt") FROM topic_research_runs r WHERE r."topicId" = t.id) AS "lastStarted"
       FROM topic_research_topics t WHERE t."onWatchlist" = TRUE ORDER BY t.id`,
  );
  const wait = (r) => (r.lastStarted ? new Date(r.lastStarted).getTime() : -Infinity);
  const due = rows.filter((r) => !r.lastStarted || nowMs - new Date(r.lastStarted).getTime() >= Number(r.refreshHours || 24) * HOUR);
  due.sort((a, b) => wait(a) - wait(b) || a.id - b.id);
  return { checked: rows.length, due: due.slice(0, max) };
}

/** After a search: true when this is the third failure in a row (not the fourth, fifth...), so the alert is raised once per streak. */
async function thirdFailureInARow(pool, topicId) {
  const { rows } = await pool.query(
    `SELECT status FROM topic_research_runs WHERE "topicId" = $1 ORDER BY "startedAt" DESC, id DESC LIMIT ${FAILURES_BEFORE_ALERT + 1}`,
    [topicId],
  );
  const s = rows.map((r) => r.status);
  return s.length >= FAILURES_BEFORE_ALERT && s.slice(0, FAILURES_BEFORE_ALERT).every((x) => x === 'failed') && s[FAILURES_BEFORE_ALERT] !== 'failed';
}

/**
 * @returns {{ checked, due, ran, skipped, failed, alerts }}
 * @param deps { searchTopic, isRunning, mayUse(userId), capture, makeFingerprint, log }
 */
async function runDueTopics({ pool, now = Date.now, maxPerTick = MAX_PER_TICK, searchTopic, isRunning, mayUse, capture, makeFingerprint, log = () => {} }) {
  const nowMs = now();
  const { checked, due } = await findDue(pool, nowMs, maxPerTick);
  const out = { checked, due: due.length, ran: 0, skipped: 0, failed: 0, alerts: 0 };
  const allowed = new Map(); // userId -> may they still use the tool (asked once per tick)
  for (const topic of due) {
    const userId = topic.userId;
    if (isRunning(userId, topic.id)) { out.skipped += 1; continue; }
    if (!allowed.has(userId)) allowed.set(userId, await mayUse(userId));
    if (!allowed.get(userId)) { out.skipped += 1; continue; }
    let failedNow = false;
    try {
      const res = await searchTopic({ pool, userId, topic, refresh: false, now });
      out.ran += 1;
      failedNow = res.status === 'failed';
    } catch (err) {
      if (err && err.status === 409) { out.skipped += 1; continue; } // someone started a search of it a moment ago
      failedNow = true;
      log(`topic ${topic.id} search failed: ${err && err.message}`);
    }
    if (failedNow) {
      out.failed += 1;
      try {
        if (await thirdFailureInARow(pool, topic.id)) {
          await capture({
            userId, source: 'topicResearchCron', category: 'alert',
            fingerprint: makeFingerprint('topicResearchCron', `topic:${topic.id}:failing`), // no date: a topic that stays broken is one inbox item
            title: 'A watched topic has failed its last three refreshes',
            body: `The Topic Research topic "${String(topic.keyword).slice(0, 80)}" could not be searched on its last three scheduled refreshes. Check its feeds and sources in Topic Research -> Settings.`,
            context: `topic ${topic.id}`,
          });
          out.alerts += 1;
        }
      } catch (err) { log(`alert for topic ${topic.id} not raised: ${err && err.message}`); }
    }
  }
  return out;
}

/** Clear page text kept for more than 30 days (the articles, scores and briefs stay), and saved search answers older than a week. */
async function purgeOld(pool, now = Date.now) {
  const nowMs = now();
  const text = await pool.query(
    `UPDATE topic_research_articles SET "extractedText" = NULL, "wordCount" = NULL
      WHERE "extractedText" IS NOT NULL AND COALESCE("extractedAt", "fetchedAt") < $1`,
    [new Date(nowMs - TEXT_KEEP_DAYS * DAY)],
  );
  // a stored prompt carries other outlets' page text, so it is kept no longer than that text is (the brief or draft itself stays)
  const cutoff = new Date(nowMs - TEXT_KEEP_DAYS * DAY);
  const briefPrompts = await pool.query('UPDATE topic_research_briefs SET "promptJson" = NULL WHERE "promptJson" IS NOT NULL AND "createdAt" < $1', [cutoff]);
  const draftPrompts = await pool.query('UPDATE topic_research_drafts SET "promptJson" = NULL WHERE "promptJson" IS NOT NULL AND "createdAt" < $1', [cutoff]);
  const cache = await pool.query('DELETE FROM topic_research_cache WHERE "createdAt" < $1', [new Date(nowMs - CACHE_KEEP_DAYS * DAY)]);
  return { textCleared: text.rowCount || 0, cacheCleared: cache.rowCount || 0, promptsCleared: (briefPrompts.rowCount || 0) + (draftPrompts.rowCount || 0) };
}

let refreshTask = null;
let purgeTask = null;
let busy = false;

/** Real dependencies for the refresh job, loaded only when it actually starts. */
function realDeps() {
  const { pool } = require('../db');
  const { searchTopic, isRunning } = require('../services/topicResearch/runSearch');
  const { capture, makeFingerprint } = require('../services/SuggestionService');
  const { loadFeatureAccess } = require('../middleware/auth');
  const mayUse = async (userId) => {
    const { rows } = await pool.query('SELECT "isAdmin" FROM users WHERE id = $1', [userId]);
    if (!rows.length) return false;
    if (rows[0].isAdmin) return true; // admins always have it, as in requireFeature
    return (await loadFeatureAccess(userId)).topicResearch !== false;
  };
  return { pool, searchTopic, isRunning, mayUse, capture, makeFingerprint, log: (m) => console.warn(`[topic-research] ${m}`) };
}

function startTopicResearchCron() {
  if (refreshTask) return;
  refreshTask = cron.schedule('*/15 * * * *', async () => {
    if (busy) return; // the last tick is still going (a search can take half a minute)
    busy = true;
    try {
      const r = await runDueTopics(realDeps());
      if (r.ran || r.failed) console.log(`[topic-research] refreshed ${r.ran}, failed ${r.failed}, skipped ${r.skipped} of ${r.due} due (${r.checked} watched)`);
    } catch (err) { console.warn('[topic-research] refresh run failed:', err.message); } finally { busy = false; }
  });
  console.log('[topic-research] watchlist refresh scheduled every 15 minutes');
}

function startTopicResearchPurge() {
  if (purgeTask) return;
  purgeTask = cron.schedule('30 3 * * *', () => {
    purgeOld(require('../db').pool).then((r) => {
      if (r.textCleared || r.cacheCleared || r.promptsCleared) console.log(`[topic-research] purge: page text cleared on ${r.textCleared} articles, ${r.promptsCleared} stored prompts cleared, ${r.cacheCleared} saved answers removed`);
    }).catch((err) => console.warn('[topic-research] purge failed:', err.message));
  });
  console.log('[topic-research] 30-day page-text clean-up scheduled daily at 03:30');
}

module.exports = { runDueTopics, purgeOld, findDue, realDeps, thirdFailureInARow, startTopicResearchCron, startTopicResearchPurge, MAX_PER_TICK, TEXT_KEEP_DAYS };
