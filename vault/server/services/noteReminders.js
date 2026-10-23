'use strict';

// Reminders on notes. A note can carry one reminder: a moment in time and whether to also email the person. When it falls due the
// note appears under "Reminders due" in Notes (that needs nothing from the server but the date); if "email me" was ticked, a
// five-minute job sends one email to the person's own address. Snoozing sets a new time; Done stops it.
// Unit-tested without a database or a mail server: node server/services/noteReminders.test.js

const MAX_YEARS_AHEAD = 5;
const PAST_GRACE_MS = 60 * 1000; // a clock a little behind the server's is not a mistake
const MAX_EMAIL_AGE_MS = 24 * 60 * 60 * 1000; // after a long outage, do not email reminders that are more than a day late
const BATCH = 100;

class ReminderError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

/** A reminder time from the browser (an ISO instant) as a Date, or a ReminderError saying what is wrong. */
function parseRemindAt(value, now = new Date()) {
  if (typeof value !== 'string' || !value.trim()) throw new ReminderError('Pick a date and time for the reminder.');
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) throw new ReminderError('That date and time could not be read.');
  if (when.getTime() < now.getTime() - PAST_GRACE_MS) throw new ReminderError('Pick a time in the future.');
  if (when.getTime() > now.getTime() + MAX_YEARS_AHEAD * 365 * 24 * 3600 * 1000) throw new ReminderError('That is too far ahead. Pick a date within five years.');
  return when;
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The email for one due reminder: the note's title and the start of its text, and a link that opens the note. All text escaped. */
function buildReminderEmail({ id, title, body, appUrl }) {
  const name = String(title || '').trim() && String(title).trim().toLowerCase() !== 'untitled' ? String(title).trim() : 'a note of yours';
  const preview = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const link = `${String(appUrl || '').replace(/\/+$/, '')}/notes?note=${encodeURIComponent(id)}`;
  return {
    subject: `Reminder: ${name}`.slice(0, 120),
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px">
  <p style="margin:0 0 8px;color:#666;font-size:13px">You asked Vault to remind you about this note.</p>
  <h2 style="margin:0 0 8px;font-size:18px">${esc(name === 'a note of yours' ? 'Your note' : name)}</h2>
  ${preview ? `<p style="margin:0 0 16px;color:#333;line-height:1.5">${esc(preview)}${String(body || '').replace(/\s+/g, ' ').trim().length > 300 ? '…' : ''}</p>` : ''}
  <p style="margin:0"><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:#CC785C;color:#fff;border-radius:8px;text-decoration:none">Open the note</a></p>
  <p style="margin:16px 0 0;color:#888;font-size:12px">In Notes you can mark it done or snooze it. Turn off "email me" on the note to stop these emails.</p>
</div>`,
  };
}

/**
 * Send every due reminder that asked for an email, once. Each is claimed in the database before it is sent (so two servers or two
 * runs never send the same one); a send that fails is put back to try next time, for up to a day, and goes to the Suggestions inbox.
 * `deps` ({ pool, sendEmail, capture, makeFingerprint, appUrl }) lets tests run without a database or a mail server. Never throws.
 */
async function runNoteReminders(now = new Date(), deps = {}) {
  const pool = deps.pool || require('../db').pool;
  const sendEmail = deps.sendEmail || require('../utils/sendEmail');
  const suggestions = deps.capture ? null : require('./SuggestionService');
  const capture = deps.capture || suggestions.capture;
  const makeFingerprint = deps.makeFingerprint || suggestions?.makeFingerprint || ((...parts) => parts.join(':'));
  const appUrl = deps.appUrl || process.env.APP_URL || 'http://localhost:5173';
  const result = { due: 0, sent: 0, failed: 0 };

  let claimed;
  try {
    const r = await pool.query(
      `UPDATE notes SET reminder_sent_at = $1
        WHERE id IN (SELECT id FROM notes
                      WHERE remind_email AND remind_at <= $1 AND remind_at > $2
                        AND reminder_done_at IS NULL AND reminder_sent_at IS NULL
                      ORDER BY remind_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, user_id, title, body`,
      [now.toISOString(), new Date(now.getTime() - MAX_EMAIL_AGE_MS).toISOString()]
    );
    claimed = r.rows;
  } catch (err) {
    console.warn('[note-reminders] could not look for due reminders:', err.message);
    return { ...result, failed: 1 };
  }
  result.due = claimed.length;

  for (const note of claimed) {
    try {
      const { rows } = await pool.query('SELECT email FROM users WHERE id=$1', [note.user_id]);
      if (!rows[0]?.email) throw new Error('this person has no email address');
      const res = await sendEmail({ to: rows[0].email, ...buildReminderEmail({ id: note.id, title: note.title, body: note.body, appUrl }) });
      if (res && res.ok === false) throw new Error(res.reason || 'the email was not sent');
      result.sent += 1;
    } catch (err) {
      result.failed += 1;
      console.warn(`[note-reminders] note ${note.id}: ${err.message}`);
      await pool.query('UPDATE notes SET reminder_sent_at = NULL WHERE id=$1', [note.id]).catch(() => {}); // try again at the next run
      try {
        await capture({
          userId: note.user_id, source: 'noteReminders', category: 'alert',
          fingerprint: makeFingerprint('noteReminders', `send:${note.id}`),
          title: 'A note reminder email could not be sent', body: err.message, context: 'server/services/noteReminders.js',
        });
      } catch { /* the inbox is a courtesy */ }
    }
  }
  return result;
}

module.exports = { ReminderError, MAX_YEARS_AHEAD, MAX_EMAIL_AGE_MS, parseRemindAt, buildReminderEmail, runNoteReminders };
