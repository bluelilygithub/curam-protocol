'use strict';

// Live TV guide refresh (docs/live-tv.md, "TV guide"): every 6 hours, fetch the free guide files and replace the stored programmes.
// Free (public files, no key), sends nothing, so it runs everywhere. Skipped while nobody has used Live TV (no favourites and no plays),
// and cron-locked so two instances never fetch at once. The page also starts a refresh itself when the guide is old or missing.

const cron = require('node-cron');
const { withCronLock } = require('../utils/cronLock');

let task = null;

async function runGuideRefresh() {
  const { pool } = require('../db');
  const { rows } = await pool.query(
    'SELECT (EXISTS (SELECT 1 FROM live_tv_favourites) OR EXISTS (SELECT 1 FROM live_tv_plays)) AS used');
  if (!rows[0].used) return null;
  const { refreshGuide } = require('../services/liveTv/guide');
  const { getCatalogue } = require('../services/liveTv/catalogue');
  return refreshGuide({ pool, getCatalogue });
}

function startLiveTvGuideCron() {
  if (task) return;
  task = cron.schedule('20 */6 * * *', async () => {
    try {
      const r = await withCronLock('live-tv-guide', runGuideRefresh);
      if (r) console.log(`[live-tv] guide: ${r.programmes} programmes for ${r.channels} channels from ${(r.files || []).length} files${r.ok ? '' : ` (problems: ${r.error || (r.failedFiles || []).join('; ')})`}`);
    } catch (err) { console.warn('[live-tv] guide refresh failed:', err.message); }
  });
  console.log('[live-tv] guide refresh scheduled every 6 hours at :20');
}

module.exports = { startLiveTvGuideCron, runGuideRefresh };
