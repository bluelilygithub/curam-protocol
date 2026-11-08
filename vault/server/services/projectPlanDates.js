'use strict';

// A client project's start and target end dates can FOLLOW its plans: the earliest start and the latest finish of the draft and active plans
// filed under it (docs/plans.md "Project dates"). The dates are still the project's own columns, so everything that already reads them (the
// Client work list, Notes' related items, the Tasks timeline) shows the plan dates without change. What the person typed is never lost:
//
//   - the first time plans take over, the typed dates are kept in "ownStartDate" / "ownTargetEndDate" and "datesDerived" is set;
//   - if the plans go away (deleted, archived, done, or nothing dated), the typed dates are put back;
//   - the person can switch following off ("datesFollowPlans" false): the typed dates return and are left alone;
//   - typing DIFFERENT dates by hand into a project whose dates come from plans switches following off (noteManualDates), so the app never
//     fights the person; saving a form that sends the same dates back changes nothing.
// Only client projects (projects.projectType = 'client') that belong to the caller are ever touched.

const plans = require('./plans');
const { PlanError } = require('./planErrors');

const COLS = `id, "projectType", "datesFollowPlans", "datesDerived", "startDate"::text AS s, "targetEndDate"::text AS e, "ownStartDate"::text AS os, "ownTargetEndDate"::text AS oe`;

async function loadProject(db, userId, projectId) {
  const id = Number(projectId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { rows } = await db.query(`SELECT ${COLS} FROM projects WHERE id = $1 AND "userId" = $2`, [id, userId]);
  return rows[0] || null;
}

/** The earliest start and latest finish of the project's draft and active plans that have dates: { start, end, planCount } (nulls when none). */
async function datesFromPlans(db, userId, projectId) {
  const { rows: planRows } = await db.query(`SELECT ${plans.PLAN_COLS} FROM plans WHERE "userId" = $1 AND "clientProjectId" = $2 AND status IN ('draft','active') ORDER BY id`, [userId, projectId]);
  let start = null; let end = null; let planCount = 0;
  for (const plan of planRows) {
    const { steps, deps } = await plans.loadSteps(db, userId, plan.id);
    const sched = (plans.computed(plan, steps, deps).schedule) || null;
    if (!sched || !sched.scheduled || !sched.projectStart || !sched.projectEnd) continue;
    planCount++;
    if (!start || sched.projectStart < start) start = sched.projectStart;
    if (!end || sched.projectEnd > end) end = sched.projectEnd;
  }
  return { start, end, planCount };
}

/** Bring the project's dates in line with its plans (or put the typed dates back). Returns { changed, derived, startDate, targetEndDate }, or null if not applicable. */
async function syncProjectDates(db, userId, projectId) {
  const p = await loadProject(db, userId, projectId);
  if (!p || p.projectType !== 'client' || !p.datesFollowPlans) return null;
  const range = await datesFromPlans(db, userId, p.id);
  if (range.start && range.end) {
    if (p.datesDerived && p.s === range.start && p.e === range.end) return { changed: false, derived: true, startDate: p.s, targetEndDate: p.e };
    await db.query(
      `UPDATE projects SET "ownStartDate" = CASE WHEN "datesDerived" THEN "ownStartDate" ELSE "startDate" END,
                           "ownTargetEndDate" = CASE WHEN "datesDerived" THEN "ownTargetEndDate" ELSE "targetEndDate" END,
                           "startDate" = $3, "targetEndDate" = $4, "datesDerived" = TRUE, "updatedAt" = NOW()
        WHERE id = $1 AND "userId" = $2`, [p.id, userId, range.start, range.end]);
    return { changed: true, derived: true, startDate: range.start, targetEndDate: range.end };
  }
  if (p.datesDerived) return restoreOwn(db, userId, p);
  return { changed: false, derived: false, startDate: p.s, targetEndDate: p.e };
}

async function restoreOwn(db, userId, p) {
  await db.query(
    `UPDATE projects SET "startDate" = "ownStartDate", "targetEndDate" = "ownTargetEndDate", "ownStartDate" = NULL, "ownTargetEndDate" = NULL, "datesDerived" = FALSE, "updatedAt" = NOW()
      WHERE id = $1 AND "userId" = $2`, [p.id, userId]);
  return { changed: true, derived: false, startDate: p.os, targetEndDate: p.oe };
}

/** Switch following on or off for a client project of the caller's. Off puts the typed dates back; on takes the plans' dates straight away. */
async function setFollow(db, userId, projectId, follow) {
  const p = await loadProject(db, userId, projectId);
  if (!p || p.projectType !== 'client') throw new PlanError('That client project was not found.', 404);
  const on = follow === true;
  if (!on && p.datesDerived) await restoreOwn(db, userId, p);
  await db.query('UPDATE projects SET "datesFollowPlans" = $3, "updatedAt" = NOW() WHERE id = $1 AND "userId" = $2', [p.id, userId, on]);
  if (on) await syncProjectDates(db, userId, p.id);
  const after = await loadProject(db, userId, p.id);
  return { follow: after.datesFollowPlans, derived: after.datesDerived, startDate: after.s, targetEndDate: after.e };
}

/**
 * A save is about to write `startDate` / `targetEndDate` (either may be undefined: not sent). If the project's dates come from its plans and a
 * DIFFERENT date is being typed, the person has chosen their own: following is switched off and no typed dates are kept. Returns true when it did.
 */
async function noteManualDates(db, userId, projectId, startDate, targetEndDate) {
  const p = await loadProject(db, userId, projectId);
  if (!p || p.projectType !== 'client' || !p.datesDerived) return false;
  const norm = (v) => (v == null || v === '' ? null : String(v).slice(0, 10));
  const differs = (sent, current) => sent !== undefined && norm(sent) !== (current || null);
  if (!differs(startDate, p.s) && !differs(targetEndDate, p.e)) return false;
  await db.query(`UPDATE projects SET "datesFollowPlans" = FALSE, "datesDerived" = FALSE, "ownStartDate" = NULL, "ownTargetEndDate" = NULL WHERE id = $1 AND "userId" = $2`, [p.id, userId]);
  return true;
}

module.exports = { datesFromPlans, syncProjectDates, setFollow, noteManualDates };
