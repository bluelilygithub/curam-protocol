'use strict';

// Plans: send steps to Tasks. A plan's steps are their own rows (docs/plans.md), so a step only becomes a real task when the person sends it.
// This makes the tasks, links each one back in plan_links (kind 'task'), and carries the waits-on links across as task dependencies. It is a
// COPY made at the moment of sending: later changes to the plan are not pushed to the task, and the task is the person's to change or
// delete. The ONE thing that flows back is its STATUS: when a task sent from a plan is ticked, started or reopened in Tasks, its plan step takes
// the same status (syncStepFromTask, called from the same three places in routes/tasks.js that already carry a task's status to Contract Review
// obligations and Fitness sessions). A step already in Tasks (its task still exists) is not sent twice; if the task was deleted the step can be sent again.

const { PlanError } = require('./planErrors');
const plans = require('./plans');
const sched = require('./planSchedule');

const DAY_MINS = 480; // an eight-hour day: the same rule the Tasks timeline uses to draw a task's length

const unique = (list) => [...new Set(list)];

/**
 * @param body { all: true } for every step, or { stepIds: [ids] } for chosen ones
 * @returns { created: [{ stepId, taskId }], skipped: [{ stepId, reason }], undated: number, dependencies: number }
 */
async function sendToTasks(pool, userId, planId, body = {}) {
  const data = await plans.get(pool, userId, planId); // a plan that is not the caller's is "not found" here
  const { plan, steps, deps } = data;
  const placed = (data.schedule && data.schedule.steps) || {};
  const live = data.tasks || {}; // stepId -> { taskId } for steps whose task still exists

  let wanted;
  if (body.all === true) wanted = steps;
  else {
    const ids = unique((Array.isArray(body.stepIds) ? body.stepIds : []).map(Number).filter((n) => Number.isInteger(n) && n > 0));
    if (!ids.length) throw new PlanError('Choose a step to send.');
    wanted = ids.map((id) => steps.find((s) => s.id === id));
    if (wanted.some((s) => !s)) throw new PlanError('That step was not found.', 404);
  }
  if (!wanted.length) throw new PlanError('This plan has no steps to send yet.');

  const skipped = wanted.filter((s) => live[s.id]).map((s) => ({ stepId: s.id, reason: 'already in Tasks' }));
  const toSend = wanted.filter((s) => !live[s.id]);
  if (!toSend.length) return { created: [], skipped, undated: 0, dependencies: 0 };

  const byId = new Map(steps.map((s) => [s.id, s]));
  const hasKids = new Set(steps.filter((s) => s.parentStepId != null).map((s) => s.parentStepId));
  const depthOf = (s) => { let d = 0; for (let cur = s, n = 0; cur && cur.parentStepId != null && n < 50; n++) { cur = byId.get(cur.parentStepId); d++; } return d; };
  const ordered = [...toSend].sort((a, b) => depthOf(a) - depthOf(b) || a.position - b.position || a.id - b.id); // a group before its sub-steps

  const taskOf = new Map(Object.entries(live).map(([sid, v]) => [Number(sid), v.taskId]));
  const created = []; let undated = 0;
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // a link whose task was deleted is stale: replace it
    await db.query(`DELETE FROM plan_links WHERE "planId" = $1 AND "userId" = $2 AND kind = 'task' AND "stepId" = ANY($3)`, [plan.id, userId, ordered.map((s) => s.id)]);
    for (const s of ordered) {
      const at = placed[s.id] || {};
      const dueDate = at.end || null;
      if (!dueDate) undated++;
      const isGroup = hasKids.has(s.id);
      const parent = s.parentStepId != null ? (taskOf.get(s.parentStepId) || null) : null;
      const notes = `From the plan "${plan.title}".${s.notes ? `\n${s.notes}` : ''}`;
      const { rows } = await db.query(
        `INSERT INTO tasks (title, notes, status, priority, "parentTaskId", "dueDate", "estimatedMinutes", "isMilestone", "userId", "clientId", "projectId", "updatedAt")
         VALUES ($1,$2,$3,'medium',$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`,
        [s.title, notes, s.status, parent, dueDate, s.isMilestone || isGroup ? null : s.durationDays * DAY_MINS, s.isMilestone ? 1 : 0, userId, plan.clientId || null, plan.clientProjectId || null]);
      taskOf.set(s.id, rows[0].id);
      created.push({ stepId: s.id, taskId: rows[0].id });
      await db.query('INSERT INTO plan_links ("userId", "planId", "stepId", kind, "refId", label) VALUES ($1,$2,$3,$4,$5,$6)', [userId, plan.id, s.id, 'task', String(rows[0].id), s.title.slice(0, 200)]);
    }

    // waits-on links between steps that now have tasks become task dependencies (skipping any that would clash with links already in Tasks)
    const involved = unique([...taskOf.values()]);
    const { rows: existing } = await db.query('SELECT "taskId", "blockedByTaskId" FROM task_dependencies WHERE "taskId" = ANY($1) OR "blockedByTaskId" = ANY($1)', [involved]);
    const known = existing.map((r) => ({ stepId: r.taskId, blockedByStepId: r.blockedByTaskId }));
    let dependencies = 0;
    for (const d of deps) {
      const a = taskOf.get(d.stepId); const b = taskOf.get(d.blockedByStepId);
      if (!a || !b || !created.some((c) => c.taskId === a || c.taskId === b)) continue; // only links that touch a task made just now
      if (known.some((k) => k.stepId === a && k.blockedByStepId === b) || sched.wouldCycle(known, a, b)) continue;
      await db.query('INSERT INTO task_dependencies ("taskId", "blockedByTaskId") VALUES ($1,$2) ON CONFLICT DO NOTHING', [a, b]);
      known.push({ stepId: a, blockedByStepId: b });
      dependencies++;
    }
    await plans.touch(db, userId, plan.id, { sync: false }); // sending tasks moves no date
    await db.query('COMMIT');
    return { created, skipped, undated, dependencies };
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

/**
 * A task's status changed in Tasks: give the same status to the plan step it was sent from (if any). Both use todo / in-progress / done.
 * Only the status moves: a date or a title changed in Tasks is not copied back. Returns how many steps changed (0 when the task did not come
 * from a plan or the step already has that status).
 */
async function syncStepFromTask(taskId, status) {
  if (!['todo', 'in-progress', 'done'].includes(status)) return 0;
  const { pool } = require('../db');
  const { rowCount } = await pool.query(
    `UPDATE plan_steps s SET status = $2, "updatedAt" = NOW()
       FROM plan_links l
      WHERE l.kind = 'task' AND l."refId" = $1::text AND l."stepId" = s.id AND l."userId" = s."userId" AND s.status <> $2`,
    [String(taskId), status]);
  return rowCount;
}

module.exports = { DAY_MINS, sendToTasks, syncStepFromTask };
