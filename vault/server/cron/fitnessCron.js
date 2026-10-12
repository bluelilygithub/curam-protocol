'use strict';

const cron = require('node-cron');
const { pool } = require('../db');

let task = null;

/** Brings every person's Tasks into step with their plan. Not an "external" job (it sends nothing), so it also runs where cron is off. */
async function syncAllTasks() {
  const { syncUserTasks } = require('../services/fitness/fitnessTasks');
  const P = require('../services/fitness/profileService');
  const { syncFitnessGoal } = require('../services/fitness/fitnessGoal');
  // everyone with a profile: each part checks its own switch (tasks default on, the goal default off)
  const { rows } = await pool.query(`SELECT "userId" FROM fitness_profiles`);
  let synced = 0;
  for (const r of rows) {
    try {
      const state = await P.getState(r.userId);
      await syncUserTasks(r.userId, state.today);
      await syncFitnessGoal(r.userId, state.today);
      synced += 1;
    } catch (err) {
      console.warn(`[fitness-cron] task sync for user ${r.userId}: ${err.message}`);
    }
  }
  return synced;
}

/** Hourly, at five past: send the reminders that are due in each person's own time zone, and tidy the Tasks that follow the plan. */
async function runFitnessCron(now = new Date()) {
  const { runReminders } = require('../services/fitness/reminderService');
  const reminders = await runReminders(now);
  const synced = await syncAllTasks();
  return { reminders, synced };
}

/** Once, shortly after boot (always, even on staging where cron is off): programs that predate Tasks linking appear straight away. */
function startFitnessTasksSync() {
  setTimeout(() => {
    syncAllTasks().then((n) => console.log(`[fitness-tasks] startup sync for ${n} people`)).catch((err) => console.warn('[fitness-tasks] startup sync failed:', err.message));
  }, 20000);
}

function startFitnessCron() {
  if (task) return;
  task = cron.schedule('5 * * * *', () => {
    runFitnessCron().then((r) => {
      if (r.reminders.sent || r.reminders.failed) console.log(`[fitness-cron] reminders ${JSON.stringify(r.reminders)}`);
    }).catch((err) => console.error('[fitness-cron] error:', err.message));
  });
  console.log('[fitness-cron] Cron scheduled: hourly at :05 (reminder emails, plan tasks)');
}

module.exports = { startFitnessCron, startFitnessTasksSync, syncAllTasks, runFitnessCron };
