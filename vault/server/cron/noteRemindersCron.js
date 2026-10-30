'use strict';

// Every five minutes: email the note reminders that have fallen due (only those with "email me" ticked). Sends mail, so like the other
// emailing jobs it is switched off where DISABLE_EXTERNAL_CRON is set (staging). Without it, due reminders still show in Notes.

const cron = require('node-cron');
const { runNoteReminders } = require('../services/noteReminders');
const { withCronLock } = require('../utils/cronLock');

let task = null;

function startNoteRemindersCron() {
  if (task) return;
  task = cron.schedule('*/5 * * * *', () => {
    withCronLock('note-reminders', runNoteReminders).then((r) => {
      if (r && r.due) console.log(`[note-reminders] ${r.sent} sent, ${r.failed} failed of ${r.due} due`);
    }).catch((err) => console.warn('[note-reminders] run failed:', err.message));
  });
  console.log('[note-reminders] scheduled every 5 minutes');
}

module.exports = { startNoteRemindersCron };
