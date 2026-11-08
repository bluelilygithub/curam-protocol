'use strict';

// How the recycle bin handles Plans. The delete route (server/routes/plans.js) snapshots the plan, its steps, their dependencies and its links
// (dates as text, so no time zone can move a date by a day) and calls moveToBin(); this puts them back. See docs/recycle-bin.md and docs/plans.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');
const { MAX_PLANS_PER_USER } = require('../../plans');

register('plan', {
  label: 'Plan',
  async restore(db, userId, payload) {
    const plan = payload?.plan;
    if (!plan || typeof plan.title !== 'string') throw new Error('This deleted plan has nothing to restore.');
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM plans WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_PLANS_PER_USER) throw new RestoreError(`You already have ${MAX_PLANS_PER_USER} plans. Delete one to bring this one back.`, 409);

    const planId = await insertRow(db, 'plans', plan, { userId });
    const steps = Array.isArray(payload.steps) ? payload.steps : [];
    const newId = new Map();
    // parents first, so a sub-step can point at its parent's new id
    const depthOf = (s) => { let d = 0; for (let cur = s, n = 0; cur && cur.parentStepId != null && n < 50; n++) { cur = steps.find((x) => x.id === cur.parentStepId); d++; } return d; };
    for (const s of [...steps].sort((a, b) => depthOf(a) - depthOf(b))) {
      const id = await insertRow(db, 'plan_steps', s, { userId, override: { planId, parentStepId: s.parentStepId != null ? (newId.get(s.parentStepId) ?? null) : null } });
      newId.set(s.id, id);
    }
    for (const d of Array.isArray(payload.deps) ? payload.deps : []) {
      if (!newId.has(d.stepId) || !newId.has(d.blockedByStepId)) continue;
      await db.query('INSERT INTO plan_step_deps ("planId", "stepId", "blockedByStepId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [planId, newId.get(d.stepId), newId.get(d.blockedByStepId)]);
    }
    for (const l of Array.isArray(payload.links) ? payload.links : []) {
      await db.query('INSERT INTO plan_links ("userId", "planId", "stepId", kind, "refId", label) VALUES ($1,$2,$3,$4,$5,$6)',
        [userId, planId, l.stepId != null ? (newId.get(l.stepId) ?? null) : null, l.kind, l.refId, l.label || '']);
    }
    await require('../../plans').syncProject(db, userId, plan.clientProjectId); // the project's dates include it again (a project that is gone left the link empty)
    return { entityId: planId };
  },
});
