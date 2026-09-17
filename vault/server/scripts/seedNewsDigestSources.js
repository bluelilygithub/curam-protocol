'use strict';

/**
 * Seeds the new grouped News Digest source list (server/services/newsAggregationService.js
 * DEFAULT_SOURCE_GROUPS) into the workspace admin's settings row, and reports live/dead
 * status for every RSS feed in it (Google News excluded — it's a keyword search, not a fixed
 * feed, so a single probe query isn't a meaningful health signal).
 *
 * Safe to re-run — will NOT overwrite an already-saved news_digest_sources value unless
 * --force is passed (so re-running this after you've customized sources in Settings won't
 * clobber your changes).
 *
 * Usage:
 *   node server/scripts/seedNewsDigestSources.js              (seed only if unset, then health-check)
 *   node server/scripts/seedNewsDigestSources.js --check-only (skip seeding, just health-check whatever is currently configured)
 *   node server/scripts/seedNewsDigestSources.js --force      (overwrite whatever is currently saved with the new defaults)
 *
 * Run via: railway ssh "node server/scripts/seedNewsDigestSources.js"
 * (railway run won't work here — the DB hostname is Railway-internal-only, see MEMORY.md)
 */

require('dotenv').config();

const { pool } = require('../db');
const { getPrimaryAdminUserId } = require('../services/SuggestionService');
const { DEFAULT_SOURCE_GROUPS, flattenSourceGroups, checkSourceHealth } = require('../services/newsAggregationService');

const CHECK_ONLY = process.argv.includes('--check-only');
const FORCE = process.argv.includes('--force');

async function run() {
  await pool.query('SELECT 1'); // wait for schema init

  const adminId = await getPrimaryAdminUserId();
  if (!adminId) {
    console.log('[seed-news-sources] No workspace admin found — nothing to do.');
    return;
  }
  console.log(`[seed-news-sources] Workspace admin userId=${adminId}`);

  let groupsToCheck = DEFAULT_SOURCE_GROUPS;

  if (!CHECK_ONLY) {
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key='news_digest_sources'`,
      [adminId]
    );
    const alreadySet = rows.length > 0;

    if (alreadySet && !FORCE) {
      console.log('[seed-news-sources] news_digest_sources already set — leaving it alone (pass --force to overwrite). Health-checking the SAVED list instead of the new defaults.');
      try {
        groupsToCheck = JSON.parse(rows[0].value);
      } catch {
        console.warn('[seed-news-sources] saved value is not valid JSON — falling back to defaults for the health check only, not overwriting.');
      }
    } else {
      await pool.query(
        `INSERT INTO settings ("userId", key, value) VALUES ($1,'news_digest_sources',$2)
         ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value`,
        [adminId, JSON.stringify(DEFAULT_SOURCE_GROUPS)]
      );
      console.log(`[seed-news-sources] ${alreadySet ? 'Overwrote' : 'Seeded'} news_digest_sources with the new grouped defaults (${Object.keys(DEFAULT_SOURCE_GROUPS).length} groups, ${flattenSourceGroups(DEFAULT_SOURCE_GROUPS).length} sources).`);
    }
  } else {
    console.log('[seed-news-sources] --check-only: not writing anything, health-checking current DB value (or defaults if unset).');
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key='news_digest_sources'`,
      [adminId]
    );
    if (rows.length) {
      try { groupsToCheck = JSON.parse(rows[0].value); } catch { /* fall back to defaults */ }
    }
  }

  const flat = flattenSourceGroups(groupsToCheck);
  console.log(`\n[seed-news-sources] Checking ${flat.filter(s => s.url !== '__google_news__').length} RSS feed(s) for liveness...`);
  const health = await checkSourceHealth(flat);

  const live = health.filter(h => h.ok);
  const dead = health.filter(h => !h.ok);

  console.log('\n[seed-news-sources] Results:');
  for (const h of health) {
    console.log(`  ${h.ok ? '✓ LIVE' : '✗ DEAD'}  ${h.name.padEnd(30)} ${h.ok ? `(${h.itemCount} items)` : h.error}`);
  }

  console.log(`\n[seed-news-sources] Summary: ${live.length} live, ${dead.length} dead, out of ${health.length} checked.`);
  if (dead.length) {
    console.log('[seed-news-sources] Dead feeds will also surface as a Suggestions-inbox alert the next time the daily cron runs (server/cron/newsDigestCron.js runDailyDigest).');
  }
}

run()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[seed-news-sources] Failed:', err);
    process.exit(1);
  });
