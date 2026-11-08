'use strict';

// Plans: a named set of steps with dates and "waits on" links, drawn as a Gantt. Mounted at /api/plans behind the `plans` flag. Every query is
// by the signed-in person; a plan that is not theirs is "not found". Delete goes into the shared recycle bin (30 days). See docs/plans.md.
//
//   GET    /api/plans                                   list (counts, no steps)
//   POST   /api/plans                                   { title?, description?, startDate?, targetEndDate?, workWeek? }
//   GET    /api/plans/by-source?kind=drawing&id=7       the person's plans made from that diagram { plans: [{ id, title }] }
//   POST   /api/plans/from-diagram/preview              { diagram, durations?, startDate?, targetEndDate?, workWeek?, includeNo? }  steps, what was left out, where they land (saves nothing)
//   POST   /api/plans/from-diagram                      the same, plus { title?, drawingId? }: makes the plan and links it to the diagram
//   POST   /api/plans/:id/send-to-tasks                 { all: true } or { stepIds: [..] }  makes real tasks from steps (a one-way copy), links them back
//   GET    /api/plans/:id                               the plan, its steps, dependencies, links and where every step lands
//   PUT    /api/plans/:id                               { title?, description?, status?, startDate?, targetEndDate?, workWeek? }
//   DELETE /api/plans/:id                               into the recycle bin
//   POST   /api/plans/:id/steps                         { title, parentStepId?, durationDays?, startDate?, isMilestone?, notes?, status? }
//   PUT    /api/plans/:id/steps/:stepId                 any of the above
//   DELETE /api/plans/:id/steps/:stepId                 the step and its sub-steps (not recycle-binned: see docs/plans.md)
//   POST   /api/plans/:id/steps/:stepId/deps            { blockedByStepId }   this step waits on that one
//   DELETE /api/plans/:id/steps/:stepId/deps/:blockedByStepId

const express = require('express');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const plans = require('../services/plans');
const planTasks = require('../services/planTasks');

const router = express.Router();
const BIN_TYPE = 'plan';

function fail(res, err, where) {
  if (err instanceof plans.PlanError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  getLogger().error({ err }, `[plans] ${where}`);
  return res.status(500).json({ error: 'Something went wrong with your plans. Try again.' });
}

router.get('/', async (req, res) => {
  try { res.json({ plans: await plans.list(pool, req.user.id), max: plans.MAX_PLANS_PER_USER }); } catch (err) { fail(res, err, 'list'); }
});

// Named routes come before /:id.
router.get('/by-source', async (req, res) => {
  try { res.json({ plans: await plans.listBySource(pool, req.user.id, req.query.kind, req.query.id) }); } catch (err) { fail(res, err, 'bySource'); }
});

router.post('/from-diagram/preview', (req, res) => {
  try { res.json(plans.previewFromDiagram(req.body || {})); } catch (err) { fail(res, err, 'previewFromDiagram'); }
});

router.post('/from-diagram', async (req, res) => {
  try { res.status(201).json(await plans.createFromDiagram(pool, req.user.id, req.body || {})); } catch (err) { fail(res, err, 'createFromDiagram'); }
});

router.post('/', async (req, res) => {
  try { res.status(201).json(await plans.create(pool, req.user.id, req.body || {})); } catch (err) { fail(res, err, 'create'); }
});

router.get('/:id', async (req, res) => {
  try { res.json(await plans.get(pool, req.user.id, req.params.id)); } catch (err) { fail(res, err, 'get'); }
});

router.put('/:id', async (req, res) => {
  try { res.json(await plans.update(pool, req.user.id, req.params.id, req.body || {})); } catch (err) { fail(res, err, 'update'); }
});

router.delete('/:id', async (req, res) => {
  const bin = require('../services/recycleBin');
  require('../services/recycleBin/adapters');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const plan = await plans.ownedPlan(db, req.user.id, req.params.id, { lock: true });
    const { steps, deps } = await plans.loadSteps(db, req.user.id, plan.id);
    const { rows: links } = await db.query('SELECT id, "stepId", kind, "refId", label FROM plan_links WHERE "planId" = $1 AND "userId" = $2', [plan.id, req.user.id]);
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: BIN_TYPE, id: plan.id, title: plan.title,
      detail: `${steps.length} step${steps.length === 1 ? '' : 's'}`, payload: { plan, steps, deps, links },
    });
    await db.query('DELETE FROM plans WHERE id = $1 AND "userId" = $2', [plan.id, req.user.id]); // steps, dependencies and links go with it
    await db.query('COMMIT');
    res.json({ ok: true, binId });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    if (err && err.code === 'TOO_LARGE') return res.status(413).json({ error: 'This plan is too big to keep in the recycle bin, so it was not deleted.' });
    fail(res, err, 'delete');
  } finally { db.release(); }
});

router.post('/:id/send-to-tasks', async (req, res) => {
  try { res.status(201).json(await planTasks.sendToTasks(pool, req.user.id, req.params.id, req.body || {})); } catch (err) { fail(res, err, 'sendToTasks'); }
});

router.post('/:id/steps', async (req, res) => {
  try { res.status(201).json({ step: await plans.addStep(pool, req.user.id, req.params.id, req.body || {}) }); } catch (err) { fail(res, err, 'addStep'); }
});

router.put('/:id/steps/:stepId', async (req, res) => {
  try { res.json({ step: await plans.updateStep(pool, req.user.id, req.params.id, req.params.stepId, req.body || {}) }); } catch (err) { fail(res, err, 'updateStep'); }
});

router.delete('/:id/steps/:stepId', async (req, res) => {
  try { await plans.deleteStep(pool, req.user.id, req.params.id, req.params.stepId); res.json({ ok: true }); } catch (err) { fail(res, err, 'deleteStep'); }
});

router.post('/:id/steps/:stepId/deps', async (req, res) => {
  try {
    await plans.addDependency(pool, req.user.id, req.params.id, req.params.stepId, (req.body || {}).blockedByStepId);
    res.status(201).json({ ok: true });
  } catch (err) { fail(res, err, 'addDependency'); }
});

router.delete('/:id/steps/:stepId/deps/:blockedByStepId', async (req, res) => {
  try {
    await plans.removeDependency(pool, req.user.id, req.params.id, req.params.stepId, req.params.blockedByStepId);
    res.json({ ok: true });
  } catch (err) { fail(res, err, 'removeDependency'); }
});

module.exports = router;
