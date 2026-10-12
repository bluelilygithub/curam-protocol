'use strict';

const express = require('express');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/aiRateLimit');
const { getLogger } = require('../middleware/requestContext');
const C = require('../services/fitness/config');
const T = require('../services/fitness/targets');
const { checkNotes } = require('../services/fitness/safety');
const { resolveUserTimezone } = require('../services/fitness/timezone');
const P = require('../services/fitness/profileService');
const { buildBaseline } = require('../services/fitness/baseline');
const { buildGoalPlan } = require('../services/fitness/goal');
const { seedDemoUser } = require('../services/fitness/demoSeed');
const Lib = require('../services/fitness/library');
const W = require('../services/fitness/weekService');

const router = express.Router();

function fail(res, err, where) {
  if (err instanceof P.ValidationError || err.status === 400) return res.status(400).json({ error: err.message });
  if (err.status === 404) return res.status(404).json({ error: err.message });
  getLogger().error({ err }, `fitness ${where} failed`);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

// Named routes only (no /:id routes in this file yet).

// Static options the screens need (scale wording, equipment, ambition ladder, disclaimer).
router.get('/meta', async (req, res) => {
  const cfg = await C.loadConfig(pool);
  res.json({
    domains: C.DOMAINS.map((id) => ({ id, label: C.DOMAIN_LABELS[id], levels: C.RATING_SCALE[id] })),
    sex: C.SEX_OPTIONS,
    equipment: C.EQUIPMENT,
    smoking: C.SMOKING,
    alcohol: C.ALCOHOL,
    dietScale: C.DIET_SCALE,
    ambitions: C.AMBITION_LEVELS,
    defaultAmbition: C.DEFAULT_AMBITION,
    ageBands: C.AGE_BANDS,
    rerate: cfg.rerate,
    disclaimer: C.DISCLAIMER,
    minAge: T.MIN_AGE,
  });
});

// Age-band defaults to pre-fill the onboarding answers. Suggestions only: the client marks them as such.
router.get('/template', async (req, res) => {
  try {
    const tz = await resolveUserTimezone(req.user.id);
    const today = T.todayInZone(tz.timezone);
    const dob = String(req.query.dob || '');
    if (!T.isIsoDate(dob)) return res.status(400).json({ error: 'dob is required (YYYY-MM-DD)' });
    const age = T.ageOn(dob, today);
    const band = T.bandForAge(age);
    if (!band) return res.status(400).json({ error: 'This planner is designed for adults aged 18 and over' });
    const cfg = await C.loadConfig(pool);
    res.json({ age, band, template: cfg.ageTemplates[band.id], healthyRange: cfg.healthyRange[band.id], timezone: tz });
  } catch (err) { fail(res, err, 'template'); }
});

router.get('/me', async (req, res) => {
  try { res.json(await P.getState(req.user.id)); } catch (err) { fail(res, err, 'me'); }
});

router.put('/profile', async (req, res) => {
  try { res.json(await P.saveProfile(req.user.id, req.body || {})); } catch (err) { fail(res, err, 'profile'); }
});

// Quick safety read of the notes boxes, so the screen can answer as the person types/leaves the field.
router.post('/safety-check', (req, res) => {
  const { workAround, otherNotes } = req.body || {};
  res.json(checkNotes(typeof workAround === 'string' ? workAround : '', typeof otherNotes === 'string' ? otherNotes : ''));
});

// Onboarding rating and every later re-rating (kind: 'onboarding' | 'rerate'). History is kept.
router.post('/ratings', async (req, res) => {
  try {
    await P.saveRatings(req.user.id, req.body || {});
    res.json(await P.getState(req.user.id));
  } catch (err) { fail(res, err, 'ratings'); }
});

router.get('/ratings/history', async (req, res) => {
  try { res.json({ history: await P.getRatingHistory(req.user.id) }); } catch (err) { fail(res, err, 'ratings history'); }
});

// Baseline assessment: numbers from code, wording from the model chosen in Settings (cached; ?refresh=1 regenerates).
router.post('/baseline', aiLimiter, async (req, res) => {
  try {
    const inp = await P.getPlanningInputs(req.user.id);
    const out = await buildBaseline({
      userId: req.user.id, profile: inp.profile, scores: inp.scores, previous: inp.previous,
      previousLabel: inp.previousLabel, notes: inp.notes, refresh: !!req.body?.refresh,
    });
    res.json({ ...out, safety: inp.state.safety });
  } catch (err) { fail(res, err, 'baseline'); }
});

// Preview a goal at an ambition level (nothing is saved). `fromAmbition` adds the "what changes" explanation.
router.post('/goal/preview', aiLimiter, async (req, res) => {
  try {
    const inp = await P.getPlanningInputs(req.user.id);
    const ambition = T.clampAmbition(req.body?.ambition ?? C.DEFAULT_AMBITION);
    const plan = await buildGoalPlan({
      userId: req.user.id, profile: inp.profile, scores: inp.scores, previous: inp.previous, currentMinutes: inp.currentMinutes, ambition,
      fromAmbition: req.body?.fromAmbition, startsOn: inp.state.today, notes: inp.notes, refresh: !!req.body?.refresh,
    });
    res.json({ plan, startsOn: inp.state.today });
  } catch (err) { fail(res, err, 'goal preview'); }
});

// Accept a goal (first time, or when revisiting it later). The old active goal is kept as history.
router.post('/goal', aiLimiter, async (req, res) => {
  try {
    const inp = await P.getPlanningInputs(req.user.id);
    const ambition = T.clampAmbition(req.body?.ambition ?? C.DEFAULT_AMBITION);
    const plan = await buildGoalPlan({
      userId: req.user.id, profile: inp.profile, scores: inp.scores, previous: inp.previous, currentMinutes: inp.currentMinutes, ambition,
      startsOn: inp.state.today, notes: inp.notes,
    });
    await P.saveGoal(req.user.id, {
      ambition: plan.ambition, startsOn: inp.state.today, milestones: plan.milestones,
      summary: { summary: plan.summary, regaining: plan.regaining, endRatings: plan.endRatings, endWeekly: plan.endWeekly, startMinutes: plan.startMinutes, now: plan.now, ambitionLabel: plan.ambitionLabel },
      source: plan.source,
    });
    res.json(await P.getState(req.user.id));
  } catch (err) { fail(res, err, 'goal'); }
});

router.get('/goal/history', async (req, res) => {
  try { res.json({ history: await P.getGoalHistory(req.user.id) }); } catch (err) { fail(res, err, 'goal history'); }
});

// Retake the wizard. { clear: true } also wipes ratings, goals and the shared profile; { clearWeight: true } (only with clear)
// also deletes the weight history, which is otherwise kept for the future diet app.
router.post('/reset', async (req, res) => {
  try { res.json(await P.resetWizard(req.user.id, { clear: req.body?.clear === true, clearWeight: req.body?.clear === true && req.body?.clearWeight === true })); } catch (err) { fail(res, err, 'reset'); }
});

// ── Exercise library (named routes before /:slug) ──
router.get('/library', async (req, res) => {
  try {
    const state = await P.getState(req.user.id);
    const equipment = state.lifestyle?.equipment || [];
    const hiddenSet = await W.loadHidden(req.user.id);
    const q = String(req.query.q || '').trim().toLowerCase();
    const pattern = String(req.query.pattern || '');
    const domain = String(req.query.domain || '');
    const setting = String(req.query.setting || '');
    const list = Lib.getLibrary().list
      .filter((e) => (!q || e.name.toLowerCase().includes(q) || e.pattern.includes(q)))
      .filter((e) => !pattern || e.pattern === pattern)
      .filter((e) => !domain || e.domains.includes(domain))
      .filter((e) => !setting || e.settings.includes(setting))
      .map((e) => ({
        slug: e.slug, name: e.name, pattern: e.pattern, domains: e.domains, settings: e.settings, equipment: e.equipment,
        level: e.level, roles: e.roles, available: Lib.isAvailable(e, equipment), hidden: hiddenSet.has(e.slug),
      }));
    res.json({ version: Lib.getLibrary().version, patterns: Lib.PATTERNS, settings: Lib.SETTINGS, exercises: list });
  } catch (err) { fail(res, err, 'library'); }
});

router.get('/library/:slug', async (req, res) => {
  try {
    const { bySlug } = Lib.getLibrary();
    const e = bySlug.get(String(req.params.slug));
    if (!e) return res.status(404).json({ error: 'Exercise not found' });
    const state = await P.getState(req.user.id);
    const link = (slug) => ({ slug, name: bySlug.get(slug)?.name || slug });
    res.json({
      ...e,
      easier: (e.easier || []).map(link),
      harder: (e.harder || []).map(link),
      available: Lib.isAvailable(e, state.lifestyle?.equipment || []),
      hidden: (await W.loadHidden(req.user.id)).has(e.slug),
      effortScale: Lib.getLibrary().effortScale,
    });
  } catch (err) { fail(res, err, 'library item'); }
});

// "Not for me": hide an exercise so the week generator never picks it (and show it again).
router.post('/library/:slug/hide', async (req, res) => {
  try { await W.setHidden(req.user.id, String(req.params.slug), true); res.json({ ok: true, hidden: true }); } catch (err) { fail(res, err, 'hide exercise'); }
});
router.post('/library/:slug/unhide', async (req, res) => {
  try { await W.setHidden(req.user.id, String(req.params.slug), false); res.json({ ok: true, hidden: false }); } catch (err) { fail(res, err, 'unhide exercise'); }
});

// ── Weeks ──
// This week (or ?start=YYYY-MM-DD, any day in the week). { exists:false } if it has not been created yet.
router.get('/week', async (req, res) => {
  try { res.json(await W.getWeek(req.user.id, T.isIsoDate(String(req.query.start || '')) ? String(req.query.start) : undefined)); } catch (err) { fail(res, err, 'week'); }
});

// Create the week if it does not exist (idempotent); { refresh: true } rebuilds it while nothing has been acted on.
router.post('/week/generate', aiLimiter, async (req, res) => {
  try {
    const start = T.isIsoDate(String(req.body?.start || '')) ? String(req.body.start) : undefined;
    res.json(await W.ensureWeek(req.user.id, { start, refresh: req.body?.refresh === true }));
  } catch (err) { fail(res, err, 'week generate'); }
});

router.get('/today', async (req, res) => {
  try { res.json(await W.getToday(req.user.id)); } catch (err) { fail(res, err, 'today'); }
});

router.post('/week/rest-day', async (req, res) => {
  try { res.json(await W.takeRestDay(req.user.id, { weekStart: req.body?.weekStart, day: req.body?.day })); } catch (err) { fail(res, err, 'rest day'); }
});

router.post('/week/rest-day/undo', async (req, res) => {
  try { res.json(await W.undoRestDay(req.user.id, { weekStart: req.body?.weekStart, day: req.body?.day })); } catch (err) { fail(res, err, 'undo rest day'); }
});

router.patch('/sessions/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Bad session id' });
    res.json(await W.moveSession(req.user.id, id, { day: req.body?.day, slot: req.body?.slot }));
  } catch (err) { fail(res, err, 'move session'); }
});

// Staging helper: create/refresh the worked-example demo user (admin only). Returns the password once, on creation.
router.post('/admin/demo-seed', requireAdmin, async (req, res) => {
  try { res.json(await seedDemoUser()); } catch (err) { fail(res, err, 'demo seed'); }
});

module.exports = router;
