'use strict';

/**
 * Planned sessions as ordinary Vault Tasks (the existing /tasks module), kept in step with the fitness plan, and open or closed
 * in both places: logging a session done completes its task, and completing (or reopening) the task in Tasks logs (or un-logs) the
 * session (`syncSessionFromTask`, called from the Tasks routes). A session done from a task is logged simply as "done as
 * planned"; effort and exercise details can be added later in Fitness.
 *
 * Rules, all about never making a task feel like a telling-off:
 *  - only sessions for today and later are tasks; a session whose day has passed unlogged quietly loses its task (no overdue red);
 *  - rest and "didn't do it" have no task;
 *  - done, partly done and swapped sessions mark their task done;
 *  - a task is created once per session (`taskSynced`): if you delete it in Tasks it stays deleted;
 *  - moving a session moves its task's due date; regenerating a week removes the old tasks with the old sessions (cascade);
 *  - "Show my sessions in Tasks" can be switched off in Profile. Reopening a task whose session was logged removes that log
 *    (including any effort or weights on it), because the two are meant to say the same thing.
 * No new tables: `tasks."fitnessSessionId"` links a task to its session.
 */

const { pool } = require('../../db');
const Ph = require('./phases');

const DONE_LIKE = new Set(['done', 'partial', 'swapped']);
const GONE = new Set(['rest', 'skipped']);

/**
 * What should happen to one session's task.
 * @param {{ status:string, date:string }} s
 * @param {string} today ISO date
 * @returns {{ action:'delete' } | { action:'keep', taskStatus:'todo'|'done' }}
 */
function planTask(s, today) {
  if (GONE.has(s.status)) return { action: 'delete' };
  if (DONE_LIKE.has(s.status)) return { action: 'keep', taskStatus: 'done' };
  if (s.date < today) return { action: 'delete' }; // planned, never logged, day gone: no overdue task
  return { action: 'keep', taskStatus: 'todo' };
}

/** The task status to set after a plan change: follow the session when it is done, else leave what the person set (to do, in progress). */
function nextTaskStatus(desired, existing) {
  if (desired === 'done') return 'done';
  return existing === 'done' ? 'todo' : existing;
}

/**
 * What a change to a task's done state should do to its session.
 * @param {boolean} isDone the task's new state
 * @param {{ status:string, date:string, weekStart:string }} s
 * @returns {'log'|'moveToday'|'unlog'|'revert'|'none'}
 */
function sessionAction(isDone, s, today, thisMonday) {
  const doneLike = DONE_LIKE.has(s.status);
  if (!isDone) return doneLike ? 'unlog' : 'none';
  if (doneLike || GONE.has(s.status)) return 'none';
  if (s.date <= today) return 'log';
  return s.weekStart === thisMonday ? 'moveToday' : 'revert'; // done early this week: it happened today; next week cannot be done yet
}

const SLOT_WORDS = { morning: 'Morning', midday: 'Midday', evening: 'Evening' };

function taskText(s) {
  return {
    title: `Fitness: ${s.title}`,
    notes: `${SLOT_WORDS[s.slot] || ''}${s.slot ? ' · ' : ''}${s.totalMinutes} min. Open Fitness, then Today, to see the exercises and log it (/fitness). This task follows your plan: moving or logging the session updates it.`,
  };
}

async function loadSettings(userId) {
  const { rows } = await pool.query('SELECT reminders FROM fitness_profiles WHERE "userId"=$1', [userId]);
  if (!rows[0]) return null;
  const r = typeof rows[0].reminders === 'string' ? JSON.parse(rows[0].reminders) : rows[0].reminders || {};
  return { showInTasks: r.showInTasks !== false };
}

async function removeAll(userId) {
  await pool.query('DELETE FROM tasks WHERE "userId"=$1 AND "fitnessSessionId" IS NOT NULL', [userId]);
  // switched off on purpose: switching back on starts fresh, rather than treating these as "deleted by the person"
  await pool.query('UPDATE fitness_planned_sessions SET "taskSynced"=FALSE WHERE "userId"=$1 AND "taskSynced"', [userId]);
}

/**
 * Brings this person's tasks into step with this week and next. Safe to run any time and as often as you like.
 * @param {number} userId
 * @param {string} today ISO date in their time zone
 */
async function syncUserTasks(userId, today) {
  const settings = await loadSettings(userId);
  if (!settings) return { skipped: 'no profile' };
  if (!settings.showInTasks) { await removeAll(userId); return { skipped: 'switched off' }; }
  const feature = await pool.query(
    `SELECT value FROM workspace_settings WHERE key='feature_tasks' LIMIT 1`,
  ).catch(() => ({ rows: [] }));
  if (feature.rows[0] && String(feature.rows[0].value) === 'false') return { skipped: 'tasks off for this workspace' };

  const monday = Ph.mondayOf(today);
  const { rows } = await pool.query(
    `SELECT s.id, s.day, s.slot, s.title, s.status, s."plannedMinutes", s."warmupMin", s."cooldownMin", s."taskSynced",
            to_char(w."weekStart",'YYYY-MM-DD') AS "weekStart",
            t.id AS "taskId", t.status AS "taskStatus", t."dueDate" AS "taskDue", t.title AS "taskTitle"
       FROM fitness_planned_sessions s
       JOIN fitness_weeks w ON w.id = s."weekId"
       LEFT JOIN tasks t ON t."fitnessSessionId" = s.id
      WHERE s."userId"=$1 AND w."weekStart" >= $2 AND w."weekStart" <= $3`,
    [userId, monday, Ph.addDays(monday, 7)],
  );
  const counts = { created: 0, updated: 0, deleted: 0 };
  for (const r of rows) {
    const date = Ph.addDays(r.weekStart, r.day);
    const plan = planTask({ status: r.status, date }, today);
    const text = taskText({ title: r.title, slot: r.slot, totalMinutes: r.plannedMinutes + r.warmupMin + r.cooldownMin });
    if (plan.action === 'delete') {
      if (r.taskId) { await pool.query('DELETE FROM tasks WHERE id=$1 AND "userId"=$2', [r.taskId, userId]); counts.deleted += 1; }
      continue;
    }
    if (!r.taskId) {
      if (r.taskSynced) continue; // it had a task once and was deleted in Tasks: leave it deleted
      const ins = await pool.query(
        `INSERT INTO tasks (title, notes, status, priority, category, "dueDate", "estimatedMinutes", "fitnessSessionId", "userId", "updatedAt")
         VALUES ($1,$2,$3,'medium','Fitness',$4,$5,$6,$7,NOW()) RETURNING id`,
        [text.title, text.notes, plan.taskStatus, date, r.plannedMinutes + r.warmupMin + r.cooldownMin, r.id, userId],
      );
      await pool.query(`INSERT INTO task_tags ("taskId", tag) VALUES ($1,'fitness')`, [ins.rows[0].id]);
      await pool.query('UPDATE fitness_planned_sessions SET "taskSynced"=TRUE WHERE id=$1', [r.id]);
      counts.created += 1;
      continue;
    }
    // an existing task: follow the session (done closes it, an undone session reopens it); keep "in progress" as the person set it
    const status = nextTaskStatus(plan.taskStatus, r.taskStatus);
    if (status !== r.taskStatus || String(r.taskDue || '').slice(0, 10) !== date || r.taskTitle !== text.title) {
      await pool.query(
        `UPDATE tasks SET status=$3, "dueDate"=$4, title=$5, notes=$6, "estimatedMinutes"=$7, "updatedAt"=NOW() WHERE id=$1 AND "userId"=$2`,
        [r.taskId, userId, status, date, text.title, text.notes, r.plannedMinutes + r.warmupMin + r.cooldownMin],
      );
      counts.updated += 1;
    }
  }
  return counts;
}

/**
 * A task was completed or reopened in Tasks: carry that to its session. Safe on any task (no link, no effect). Never throws.
 * @param {number} taskId
 * @param {boolean} isDone
 */
async function syncSessionFromTask(taskId, isDone) {
  try {
    const { rows } = await pool.query(
      `SELECT t."userId", t."fitnessSessionId" AS sid FROM tasks t WHERE t.id=$1 AND t."fitnessSessionId" IS NOT NULL`, [taskId],
    );
    if (!rows[0]) return;
    const { userId, sid } = rows[0];
    const P = require('./profileService');
    const state = await P.getState(userId);
    const { rows: ss } = await pool.query(
      `SELECT s.day, s.slot, s.status, to_char(w."weekStart",'YYYY-MM-DD') AS "weekStart"
         FROM fitness_planned_sessions s JOIN fitness_weeks w ON w.id = s."weekId" WHERE s.id=$1 AND s."userId"=$2`, [sid, userId],
    );
    if (!ss[0]) return;
    const session = { ...ss[0], date: Ph.addDays(ss[0].weekStart, ss[0].day) };
    const action = sessionAction(isDone, session, state.today, Ph.mondayOf(state.today));
    const L = require('./logService');
    const W = require('./weekService');
    if (action === 'moveToday') {
      await W.moveSession(userId, sid, { day: Ph.dayOfWeek(state.today), slot: session.slot });
      await L.logSession(userId, sid, { status: 'done' }, { skipWindow: true });
    } else if (action === 'log') {
      await L.logSession(userId, sid, { status: 'done' }, { skipWindow: true });
    } else if (action === 'unlog') {
      await L.undoLog(userId, sid);
    } else if (action === 'revert') {
      await pool.query(`UPDATE tasks SET status='todo', "updatedAt"=NOW() WHERE id=$1`, [taskId]);
    }
  } catch (err) {
    console.warn('[fitness/tasks] could not carry the task change to its session:', err.message);
  }
}

/** Fire and forget after anything that changes sessions: it must never slow down or break the fitness action itself. */
const lastRun = new Map();
const READ_THROTTLE_MS = 5 * 60 * 1000;

function syncSoon(userId, { force = true } = {}) {
  const now = Date.now();
  if (!force && now - (lastRun.get(userId) || 0) < READ_THROTTLE_MS) return;
  lastRun.set(userId, now);
  setImmediate(async () => {
    try {
      const P = require('./profileService');
      const state = await P.getState(userId);
      await syncUserTasks(userId, state.today);
      await require('./fitnessGoal').syncFitnessGoal(userId, state.today);
    } catch (err) {
      console.warn('[fitness/tasks] sync failed:', err.message);
    }
  });
}

module.exports = { planTask, nextTaskStatus, sessionAction, taskText, syncUserTasks, syncSessionFromTask, syncSoon };
