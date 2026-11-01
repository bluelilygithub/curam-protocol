'use strict';

// Looks for new videos from the YouTube channels and searches people follow (services/youtubeFollows.js). Runs every 6 hours; each follow decides
// for itself whether it is due (a channel about every 5 hours, a search about once a day), so a run that finds nothing due costs nothing. Uses the
// cached, quota-counted YouTube calls and stops at once if the day's allowance is spent. Wrapped in the cron lock so two servers during a deploy do
// not both run it. Sends no email: new videos show on the YouTube page and in Needs attention.

const { pool } = require('../db');
const { withCronLock } = require('../utils/cronLock');
const youtubeApi = require('../services/youtubeApi');
const follows = require('../services/youtubeFollows');

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let timer = null;

async function run() {
  if (!process.env.YOUTUBE_API_KEY) return undefined;
  return withCronLock('youtube-follows', async () => {
    try {
      const q = await youtubeApi.quotaStatus(pool);
      const out = await follows.runChecks(pool, (path) => youtubeApi.ytGet(pool, path), { searchesLeft: q.searchesLeft });
      if (out.checked || out.errors) console.log(`[youtube-follows] checked ${out.checked}, ${out.found} new video${out.found === 1 ? '' : 's'}, ${out.errors} error${out.errors === 1 ? '' : 's'}`);
      return out;
    } catch (err) {
      console.warn('[youtube-follows] run failed:', err.message);
      return undefined;
    }
  });
}

function startYoutubeFollows() {
  setTimeout(run, 3 * 60 * 1000);
  timer = setInterval(run, SIX_HOURS_MS);
  timer.unref?.();
}

module.exports = { startYoutubeFollows, run };
