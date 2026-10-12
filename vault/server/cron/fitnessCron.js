'use strict';

const cron = require('node-cron');
const { pool } = require('../db');

let task = null;

/** Hourly, at five past: send the reminders that are due in each person's own time zone, and tidy the Tasks that follow the plan. */
async function runFitnessCron(now = new Date()) {
  const { runReminders } = require('../services/fitness/reminderService');
  const { syncUserTasks } = require('../services/fitness/fitnessTasks');
  const P = require('../services/fitness/profileService');
  const reminders = await runReminders(now);
  const { rows } = await pool.query(`SELECT "userId" FROM fitness_profiles WHERE reminders->>'showInTasks' IS DISTINCT FROM 'false'`);
  let synced = 0;
  for (const r of rows) {
    try {
      const state = await P.getState(r.userId);
      await syncUserTasks(r.userId, state.today);
      synced += 1;
    } catch (err) {
      console.warn(`[fitness-cron] task sync for user ${r.userId}: ${err.message}`);
    }
  }
  return { reminders, synced };
}

function startFitnessCron() {
  if (task) return;
  task = cron.schedule('5 * * * *', () => {
    runFitnessCron().then((r) => {
      if (r.reminders.sent || r.reminders.failed) console.log(`[fitness-cron] reminders ${JSON.stringify(r.reminders)}`);
    }).catch((err) => console.error('[fitness-cron] error:', err.message));
  });
  console.log('[fitness-cron] Cron scheduled: hourly at :05 (reminder emails, plan tasks)');
  // once, shortly after boot: programs that existed before Tasks linking appear straight away
  setTimeout(() => {
    runFitnessCron().then((r) => console.log(`[fitness-cron] startup sync: ${JSON.stringify(r)}`)).catch((err) => console.warn('[fitness-cron] startup sync failed:', err.message));
  }, 20000);
}

module.exports = { startFitnessCron, runFitnessCron };
