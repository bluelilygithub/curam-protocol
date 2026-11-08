'use strict';

// Plans: rules and SQL. Every query is by the signed-in person; a plan or step that is not theirs is simply "not found". The date maths is in
// planSchedule.js (no database). The HTTP layer is routes/plans.js. See docs/plans.md.

const sched = require('./planSchedule');
const fromDiagram = require('./planFromDiagram');
const { PlanError } = require('./planErrors');

const MAX_PLANS_PER_USER = 100;
const MAX_STEPS_PER_PLAN = 300;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;
const MAX_NOTES = 4000;
const MAX_DURATION_DAYS = 3650;
const STEP_STATUSES = ['todo', 'in-progress', 'done'];
const PLAN_STATUSES = ['draft', 'active', 'done', 'archived'];
const WORK_WEEKS = ['weekdays', 'all'];
const DEFAULT_TITLE = 'Untitled plan';

const stripControl = (v) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ');
const cleanTitle = (v, fallback = DEFAULT_TITLE) => stripControl(v).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) || fallback;
const cleanText = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ').trim().slice(0, max);

function cleanDate(v, label) {
  if (v == null || v === '') return null;
  if (!sched.isISO(v)) throw new PlanError(`${label} must be a date like 2026-12-07.`);
  return v;
}
function cleanDuration(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_DURATION_DAYS || Math.round(n) !== n) throw new PlanError(`Days must be a whole number from 0 to ${MAX_DURATION_DAYS}.`);
  return n;
}
function oneOf(v, list, label) {
  if (!list.includes(v)) throw new PlanError(`${label} is not known.`);
  return v;
}
const idOf = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };

// DATE columns come back as JS Dates; ask for text so they stay 'YYYY-MM-DD'.
const PLAN_COLS = `id, title, description, status, "startDate"::text AS "startDate", "targetEndDate"::text AS "targetEndDate", "workWeek", "sourceKind", "sourceId", "createdAt", "updatedAt"`;
const STEP_COLS = `id, "planId", title, notes, "parentStepId", position, "startDate"::text AS "startDate", "durationDays", "isMilestone", status, "createdAt", "updatedAt"`;

async function ownedPlan(db, userId, planId, { lock = false } = {}) {
  const id = idOf(planId);
  const { rows } = id ? await db.query(`SELECT ${PLAN_COLS} FROM plans WHERE id = $1 AND "userId" = $2${lock ? ' FOR UPDATE' : ''}`, [id, userId]) : { rows: [] };
  if (!rows[0]) throw new PlanError('That plan was not found.', 404);
  return rows[0];
}
async function ownedStep(db, userId, planId, stepId) {
  const id = idOf(stepId);
  const { rows } = id ? await db.query(`SELECT ${STEP_COLS} FROM plan_steps WHERE id = $1 AND "planId" = $2 AND "userId" = $3`, [id, idOf(planId), userId]) : { rows: [] };
  if (!rows[0]) throw new PlanError('That step was not found.', 404);
  return rows[0];
}

async function list(db, userId) {
  const { rows } = await db.query(
    `SELECT p.id, p.title, p.description, p.status, p."startDate"::text AS "startDate", p."targetEndDate"::text AS "targetEndDate", p."workWeek", p."updatedAt",
            COUNT(s.id) AS "stepCount", COUNT(s.id) FILTER (WHERE s.status = 'done') AS "doneCount"
       FROM plans p LEFT JOIN plan_steps s ON s."planId" = p.id AND s."userId" = p."userId"
      WHERE p."userId" = $1 GROUP BY p.id ORDER BY p."updatedAt" DESC, p.id DESC`, [userId]);
  return rows.map((r) => ({ ...r, stepCount: Number(r.stepCount), doneCount: Number(r.doneCount) }));
}

async function loadSteps(db, userId, planId) {
  const { rows: steps } = await db.query(`SELECT ${STEP_COLS} FROM plan_steps WHERE "planId" = $1 AND "userId" = $2 ORDER BY position, id`, [planId, userId]);
  const { rows: deps } = await db.query(
    `SELECT d."stepId", d."blockedByStepId" FROM plan_step_deps d JOIN plan_steps s ON s.id = d."stepId"
      WHERE d."planId" = $1 AND s."userId" = $2 ORDER BY d.id`, [planId, userId]);
  return { steps, deps };
}

/** The plan with its steps, dependencies, links and where every step lands. */
async function get(db, userId, planId) {
  const plan = await ownedPlan(db, userId, planId);
  const { steps, deps } = await loadSteps(db, userId, plan.id);
  const { rows: links } = await db.query(`SELECT id, "stepId", kind, "refId", label, "createdAt" FROM plan_links WHERE "planId" = $1 AND "userId" = $2 ORDER BY id`, [plan.id, userId]);
  // Steps that have been sent to Tasks and whose task still exists (a deleted task drops out): stepId -> { taskId, status }.
  const { rows: sent } = await db.query(
    `SELECT l."stepId", t.id AS "taskId", t.status FROM plan_links l JOIN tasks t ON t.id::text = l."refId" AND t."userId" = l."userId"
      WHERE l."planId" = $1 AND l."userId" = $2 AND l.kind = 'task' AND l."stepId" IS NOT NULL ORDER BY l.id`, [plan.id, userId]);
  const tasks = {};
  for (const r of sent) tasks[r.stepId] = { taskId: r.taskId, status: r.status };
  return { plan, steps, deps, links, tasks, ...computed(plan, steps, deps) };
}

function computed(plan, steps, deps) {
  let result;
  try {
    result = sched.schedule({ steps, deps, startDate: plan.startDate, targetEndDate: plan.targetEndDate, workWeek: plan.workWeek });
  } catch (err) {
    if (err.code === 'CYCLE') return { schedule: null, error: err.message };
    throw err;
  }
  const placed = {};
  for (const [id, r] of result.steps) placed[id] = r;
  // Only offered when the plan has an end date but no start: "start on X to finish on time".
  const suggestedStart = !plan.startDate && plan.targetEndDate ? sched.startFromEnd({ steps, deps, targetEndDate: plan.targetEndDate, workWeek: plan.workWeek }) : null;
  return {
    schedule: { steps: placed, projectStart: result.projectStart, projectEnd: result.projectEnd, workDays: result.workDays, scheduled: result.scheduled, fit: result.fit, suggestedStart },
  };
}

async function create(db, userId, body = {}) {
  const { rows: n } = await db.query('SELECT COUNT(*) AS n FROM plans WHERE "userId" = $1', [userId]);
  if (Number(n[0].n) >= MAX_PLANS_PER_USER) throw new PlanError(`You already have ${MAX_PLANS_PER_USER} plans. Delete one to make room.`, 409, 'LIMIT');
  const startDate = cleanDate(body.startDate, 'Start date');
  const targetEndDate = cleanDate(body.targetEndDate, 'End date');
  if (startDate && targetEndDate && targetEndDate < startDate) throw new PlanError('The end date is before the start date.');
  const { rows } = await db.query(
    `INSERT INTO plans ("userId", title, description, status, "startDate", "targetEndDate", "workWeek", "sourceKind", "sourceId")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [userId, cleanTitle(body.title), cleanText(body.description, MAX_DESCRIPTION),
      body.status == null ? 'active' : oneOf(body.status, PLAN_STATUSES, 'That status'), startDate, targetEndDate,
      body.workWeek == null ? 'weekdays' : oneOf(body.workWeek, WORK_WEEKS, 'That work week'),
      body.sourceKind ? cleanText(body.sourceKind, 40) : null, body.sourceId != null && body.sourceId !== '' ? cleanText(body.sourceId, 100) : null]);
  return get(db, userId, rows[0].id);
}

async function update(db, userId, planId, body = {}) {
  const plan = await ownedPlan(db, userId, planId, { lock: true });
  const next = {
    title: 'title' in body ? cleanTitle(body.title, plan.title) : plan.title,
    description: 'description' in body ? cleanText(body.description, MAX_DESCRIPTION) : plan.description,
    status: 'status' in body ? oneOf(body.status, PLAN_STATUSES, 'That status') : plan.status,
    startDate: 'startDate' in body ? cleanDate(body.startDate, 'Start date') : plan.startDate,
    targetEndDate: 'targetEndDate' in body ? cleanDate(body.targetEndDate, 'End date') : plan.targetEndDate,
    workWeek: 'workWeek' in body ? oneOf(body.workWeek, WORK_WEEKS, 'That work week') : plan.workWeek,
  };
  if (next.startDate && next.targetEndDate && next.targetEndDate < next.startDate) throw new PlanError('The end date is before the start date.');
  await db.query(
    `UPDATE plans SET title=$3, description=$4, status=$5, "startDate"=$6, "targetEndDate"=$7, "workWeek"=$8, "updatedAt"=NOW() WHERE id=$1 AND "userId"=$2`,
    [plan.id, userId, next.title, next.description, next.status, next.startDate, next.targetEndDate, next.workWeek]);
  return get(db, userId, plan.id);
}

async function touch(db, userId, planId) {
  await db.query('UPDATE plans SET "updatedAt" = NOW() WHERE id = $1 AND "userId" = $2', [planId, userId]);
}

async function hasDeps(db, stepId) {
  const { rows } = await db.query('SELECT 1 FROM plan_step_deps WHERE "stepId" = $1 OR "blockedByStepId" = $1 LIMIT 1', [stepId]);
  return rows.length > 0;
}

/** A step may only be put under another step in the same plan, never under itself or one of its own children. */
async function checkParent(db, userId, planId, stepId, parentStepId) {
  if (parentStepId == null) return null;
  const parent = await ownedStep(db, userId, planId, parentStepId).catch(() => { throw new PlanError('The group you chose is not in this plan.'); });
  if (stepId && parent.id === stepId) throw new PlanError('A step cannot be inside itself.');
  if (stepId) {
    const { rows } = await db.query('SELECT id, "parentStepId" FROM plan_steps WHERE "planId" = $1 AND "userId" = $2', [planId, userId]);
    const up = new Map(rows.map((r) => [r.id, r.parentStepId]));
    for (let cur = parent.id, hops = 0; cur != null && hops < 1000; cur = up.get(cur), hops++) {
      if (cur === stepId) throw new PlanError('A step cannot be moved inside one of its own sub-steps.');
    }
  }
  // A group takes its dates from its children, so a step that waits on something (or is waited on) cannot become one.
  if (await hasDeps(db, parent.id)) throw new PlanError('That step has dependencies, so it cannot hold sub-steps. Remove its dependencies first.', 409);
  return parent.id;
}

async function addStep(db, userId, planId, body = {}) {
  const plan = await ownedPlan(db, userId, planId, { lock: true });
  const { rows: n } = await db.query('SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS pos FROM plan_steps WHERE "planId" = $1 AND "userId" = $2', [plan.id, userId]);
  if (Number(n[0].n) >= MAX_STEPS_PER_PLAN) throw new PlanError(`A plan can have ${MAX_STEPS_PER_PLAN} steps. Split this one into two plans.`, 409, 'LIMIT');
  const title = cleanTitle(body.title, '');
  if (!title) throw new PlanError('Give the step a name.');
  const isMilestone = body.isMilestone === true;
  const parentStepId = await checkParent(db, userId, plan.id, 0, body.parentStepId == null ? null : idOf(body.parentStepId) || -1);
  const { rows } = await db.query(
    `INSERT INTO plan_steps ("planId", "userId", title, notes, "parentStepId", position, "startDate", "durationDays", "isMilestone", status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [plan.id, userId, title, cleanText(body.notes, MAX_NOTES), parentStepId, Number(n[0].pos) + 1, cleanDate(body.startDate, 'Start date'),
      isMilestone ? 0 : (body.durationDays == null ? 1 : Math.max(1, cleanDuration(body.durationDays))), isMilestone,
      body.status == null ? 'todo' : oneOf(body.status, STEP_STATUSES, 'That status')]);
  await touch(db, userId, plan.id);
  return ownedStep(db, userId, plan.id, rows[0].id);
}

async function updateStep(db, userId, planId, stepId, body = {}) {
  const plan = await ownedPlan(db, userId, planId, { lock: true });
  const step = await ownedStep(db, userId, plan.id, stepId);
  const isMilestone = 'isMilestone' in body ? body.isMilestone === true : step.isMilestone;
  let durationDays = 'durationDays' in body ? cleanDuration(body.durationDays) : step.durationDays;
  durationDays = isMilestone ? 0 : Math.max(1, durationDays);
  let parentStepId = step.parentStepId;
  if ('parentStepId' in body) parentStepId = await checkParent(db, userId, plan.id, step.id, body.parentStepId == null ? null : idOf(body.parentStepId) || -1);
  await db.query(
    `UPDATE plan_steps SET title=$4, notes=$5, "parentStepId"=$6, "startDate"=$7, "durationDays"=$8, "isMilestone"=$9, status=$10, "updatedAt"=NOW()
      WHERE id=$1 AND "planId"=$2 AND "userId"=$3`,
    [step.id, plan.id, userId,
      'title' in body ? (cleanTitle(body.title, '') || step.title) : step.title,
      'notes' in body ? cleanText(body.notes, MAX_NOTES) : step.notes,
      parentStepId, 'startDate' in body ? cleanDate(body.startDate, 'Start date') : step.startDate, durationDays, isMilestone,
      'status' in body ? oneOf(body.status, STEP_STATUSES, 'That status') : step.status]);
  await touch(db, userId, plan.id);
  return ownedStep(db, userId, plan.id, step.id);
}

async function deleteStep(db, userId, planId, stepId) {
  const plan = await ownedPlan(db, userId, planId, { lock: true });
  const step = await ownedStep(db, userId, plan.id, stepId);
  await db.query('DELETE FROM plan_steps WHERE id = $1 AND "planId" = $2 AND "userId" = $3', [step.id, plan.id, userId]); // its sub-steps, dependencies and links go with it
  await touch(db, userId, plan.id);
}

async function addDependency(db, userId, planId, stepId, blockedByStepId) {
  const plan = await ownedPlan(db, userId, planId, { lock: true });
  const a = await ownedStep(db, userId, plan.id, stepId);
  const b = await ownedStep(db, userId, plan.id, blockedByStepId);
  if (a.id === b.id) throw new PlanError('A step cannot wait on itself.');
  const { rows: groups } = await db.query('SELECT DISTINCT "parentStepId" AS id FROM plan_steps WHERE "planId" = $1 AND "userId" = $2 AND "parentStepId" IS NOT NULL', [plan.id, userId]);
  if (groups.some((g) => g.id === a.id || g.id === b.id)) throw new PlanError('A group takes its dates from its sub-steps. Link the sub-steps instead.', 409);
  const { rows: deps } = await db.query('SELECT "stepId", "blockedByStepId" FROM plan_step_deps WHERE "planId" = $1', [plan.id]);
  if (sched.wouldCycle(deps, a.id, b.id)) throw new PlanError('That would make the steps wait on each other in a circle.', 409, 'CYCLE');
  await db.query('INSERT INTO plan_step_deps ("planId", "stepId", "blockedByStepId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [plan.id, a.id, b.id]);
  await touch(db, userId, plan.id);
}

async function removeDependency(db, userId, planId, stepId, blockedByStepId) {
  const plan = await ownedPlan(db, userId, planId, { lock: true });
  await ownedStep(db, userId, plan.id, stepId);
  await db.query('DELETE FROM plan_step_deps WHERE "planId" = $1 AND "stepId" = $2 AND "blockedByStepId" = $3', [plan.id, idOf(stepId), idOf(blockedByStepId)]);
  await touch(db, userId, plan.id);
}

/**
 * Plan steps for the Tasks calendar: every step of the person's draft and active plans that is not finished, not a group and not already a task
 * in Tasks (a sent step shows as the task itself), placed on its last day. Optional `from` / `to` ('YYYY-MM-DD') keep it to a range. Read-only.
 */
async function calendarSteps(db, userId, { from = null, to = null } = {}) {
  const f = from ? cleanDate(from, 'From') : null;
  const t = to ? cleanDate(to, 'To') : null;
  const { rows: planRows } = await db.query(`SELECT ${PLAN_COLS} FROM plans WHERE "userId" = $1 AND status IN ('draft','active') ORDER BY id`, [userId]);
  if (!planRows.length) return [];
  const ids = planRows.map((p) => p.id);
  const { rows: stepRows } = await db.query(`SELECT ${STEP_COLS} FROM plan_steps WHERE "userId" = $1 AND "planId" = ANY($2) ORDER BY position, id`, [userId, ids]);
  const { rows: depRows } = await db.query(
    `SELECT d."planId", d."stepId", d."blockedByStepId" FROM plan_step_deps d JOIN plan_steps s ON s.id = d."stepId" WHERE d."planId" = ANY($1) AND s."userId" = $2`, [ids, userId]);
  const { rows: sentRows } = await db.query(
    `SELECT l."stepId" FROM plan_links l JOIN tasks tk ON tk.id::text = l."refId" AND tk."userId" = l."userId"
      WHERE l."planId" = ANY($1) AND l."userId" = $2 AND l.kind = 'task' AND l."stepId" IS NOT NULL`, [ids, userId]);
  const sent = new Set(sentRows.map((r) => r.stepId));
  const events = [];
  for (const plan of planRows) {
    const steps = stepRows.filter((s) => s.planId === plan.id);
    const deps = depRows.filter((d) => d.planId === plan.id);
    const placed = (computed(plan, steps, deps).schedule || {}).steps || {};
    for (const s of steps) {
      const at = placed[s.id];
      if (!at || at.isGroup || !at.end || s.status === 'done' || sent.has(s.id)) continue;
      if ((f && at.end < f) || (t && at.end > t)) continue;
      events.push({ planId: plan.id, planTitle: plan.title, stepId: s.id, title: s.title, startDate: at.start, endDate: at.end, isMilestone: !!s.isMilestone, status: s.status });
    }
  }
  return events;
}

/** The draft for a diagram, with the person's lengths and dates applied and where everything lands. Nothing is saved. */
function previewFromDiagram(body = {}) {
  const startDate = cleanDate(body.startDate, 'Start date');
  const targetEndDate = cleanDate(body.targetEndDate, 'End date');
  if (startDate && targetEndDate && targetEndDate < startDate) throw new PlanError('The end date is before the start date.');
  const workWeek = body.workWeek == null ? 'weekdays' : oneOf(body.workWeek, WORK_WEEKS, 'That work week');
  const draft = fromDiagram.buildDraft(body.diagram, { includeNo: body.includeNo === true });
  const steps = fromDiagram.applyDurations(draft.steps, body.durations);
  let schedule;
  try { schedule = fromDiagram.place(steps, { startDate, targetEndDate, workWeek }); } catch (err) { if (err.code === 'CYCLE') throw new PlanError(err.message); throw err; }
  return { steps, droppedLoops: draft.droppedLoops, leftOut: draft.leftOut, schedule, startDate, targetEndDate, workWeek };
}

/** Make the plan from a diagram: the plan, its steps and their dependencies, and a link back to the diagram, all or nothing. */
async function createFromDiagram(pool, userId, body = {}) {
  const preview = previewFromDiagram(body);
  const drawingId = body.drawingId == null || body.drawingId === '' ? 0 : idOf(body.drawingId);
  if (body.drawingId != null && body.drawingId !== '' && !drawingId) throw new PlanError('That diagram was not found.', 404);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    let drawing = null;
    if (drawingId) {
      const { rows } = await db.query('SELECT id, title FROM drawings WHERE id = $1 AND "userId" = $2', [drawingId, userId]);
      if (!rows[0]) throw new PlanError('That diagram was not found.', 404); // the link is only ever written to a diagram the person owns
      drawing = rows[0];
    }
    const { rows: n } = await db.query('SELECT COUNT(*) AS n FROM plans WHERE "userId" = $1', [userId]);
    if (Number(n[0].n) >= MAX_PLANS_PER_USER) throw new PlanError(`You already have ${MAX_PLANS_PER_USER} plans. Delete one to make room.`, 409, 'LIMIT');
    const { rows: planRows } = await db.query(
      `INSERT INTO plans ("userId", title, description, status, "startDate", "targetEndDate", "workWeek", "sourceKind", "sourceId")
       VALUES ($1,$2,$3,'active',$4,$5,$6,$7,$8) RETURNING id`,
      [userId, cleanTitle(body.title || (drawing && drawing.title), 'Plan from a diagram'), cleanText(body.description, MAX_DESCRIPTION),
        preview.startDate, preview.targetEndDate, preview.workWeek, drawing ? 'drawing' : null, drawing ? String(drawing.id) : null]);
    const planId = planRows[0].id;
    const idOf2 = new Map();
    let position = 0;
    for (const s of preview.steps) {
      const { rows } = await db.query(
        `INSERT INTO plan_steps ("planId", "userId", title, notes, position, "durationDays", "isMilestone")
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [planId, userId, cleanTitle(s.title, 'Step'), cleanText(s.notes, MAX_NOTES), ++position, s.durationDays, s.isMilestone]);
      idOf2.set(s.ref, rows[0].id);
    }
    for (const s of preview.steps) for (const b of s.waitsOn) {
      await db.query('INSERT INTO plan_step_deps ("planId", "stepId", "blockedByStepId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [planId, idOf2.get(s.ref), idOf2.get(b)]);
    }
    if (drawing) await db.query('INSERT INTO plan_links ("userId", "planId", kind, "refId", label) VALUES ($1,$2,$3,$4,$5)', [userId, planId, 'drawing', String(drawing.id), cleanTitle(drawing.title, '')]);
    await db.query('COMMIT');
    return get(pool, userId, planId);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

/** The person's plans that were made from one thing (a diagram, for now): { id, title } each, newest first. */
async function listBySource(db, userId, kind, id) {
  const k = cleanText(kind, 40); const ref = cleanText(id, 100);
  if (!k || !ref) throw new PlanError('Say which diagram.');
  const { rows } = await db.query(
    `SELECT id, title FROM plans WHERE "userId" = $1 AND "sourceKind" = $2 AND "sourceId" = $3 ORDER BY "createdAt" DESC, id DESC LIMIT 50`, [userId, k, ref]);
  return rows;
}

module.exports = {
  PlanError, previewFromDiagram, createFromDiagram, listBySource, MAX_PLANS_PER_USER, MAX_STEPS_PER_PLAN, MAX_TITLE, STEP_STATUSES, PLAN_STATUSES, WORK_WEEKS,
  cleanTitle, cleanText, cleanDate, cleanDuration, PLAN_COLS, STEP_COLS,
  calendarSteps, touch, list, get, create, update, addStep, updateStep, deleteStep, addDependency, removeDependency, ownedPlan, loadSteps,
};
