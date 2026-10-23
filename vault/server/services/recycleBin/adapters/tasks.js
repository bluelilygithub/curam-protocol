'use strict';

// How the recycle bin handles Tasks and Goals. The routes that delete them call snapshotTask / snapshotObjective + moveToBin();
// this file also says how to put them back. See docs/recycle-bin.md.

const fs = require('fs');
const { register } = require('../index');
const { insertRow } = require('../rowRestore');

const ids = (list) => (Array.isArray(list) ? list.filter(Number.isInteger) : []);

// ── Tasks ───────────────────────────────────────────────────────────────────

/**
 * Everything that disappears with a task: the task, its subtasks, their tags and comments, the blocked-by links, and which files were attached.
 * The files stay on disk and in `attachments` while the task waits in the bin (they cannot be opened meanwhile); a restore reconnects them.
 * Run inside the delete's transaction. Returns null when the person has no such task.
 */
async function snapshotTask(db, userId, taskId) {
  const { rows } = await db.query('SELECT * FROM tasks WHERE id=$1 AND "userId"=$2 FOR UPDATE', [taskId, userId]);
  const task = rows[0];
  if (!task) return null;
  const subtasks = (await db.query('SELECT * FROM tasks WHERE "parentTaskId"=$1 ORDER BY id', [taskId])).rows;
  const all = [taskId, ...subtasks.map((s) => s.id)];
  const tags = {}; const comments = {};
  for (const r of (await db.query('SELECT "taskId", tag FROM task_tags WHERE "taskId" = ANY($1::int[]) ORDER BY id', [all])).rows) (tags[r.taskId] ||= []).push(r.tag);
  for (const r of (await db.query('SELECT "taskId", type, content, "createdAt" FROM task_comments WHERE "taskId" = ANY($1::int[]) ORDER BY id', [all])).rows) {
    (comments[r.taskId] ||= []).push({ type: r.type, content: r.content, createdAt: r.createdAt });
  }
  const dependencies = (await db.query(
    'SELECT "taskId", "blockedByTaskId" FROM task_dependencies WHERE "taskId" = ANY($1::int[]) OR "blockedByTaskId" = ANY($1::int[])', [all])).rows;
  const attachments = (await db.query(`SELECT id, "entityId" FROM attachments WHERE "entityType"='task' AND "entityId" = ANY($1::int[]) ORDER BY id`, [all])).rows;
  const bits = [];
  if (task.dueDate) bits.push(`Due ${String(task.dueDate).slice(0, 10)}`);
  if (subtasks.length) bits.push(`${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'}`);
  if (attachments.length) bits.push(`${attachments.length} file${attachments.length === 1 ? '' : 's'}`);
  return {
    title: task.title,
    detail: bits.join(' · ') || null,
    payload: { task, subtasks, tags, comments, dependencies, attachments },
  };
}

register('task', {
  label: 'Task',
  async restore(db, userId, payload) {
    const main = payload?.task;
    if (!main) throw new Error('This deleted task has nothing to restore.');
    const newIds = new Map();
    // A public share link is a unique address: if it has been used since, the task comes back without one.
    const freeToken = async (t) => {
      if (!t.shareToken) return null;
      return (await db.query('SELECT 1 FROM tasks WHERE "shareToken"=$1', [t.shareToken])).rows.length ? null : t.shareToken;
    };
    // A task that was itself a subtask comes back under its parent if the parent is still there, else on its own (the link check does that).
    const mainId = await insertRow(db, 'tasks', main, { userId, override: { shareToken: await freeToken(main) } });
    newIds.set(main.id, mainId);
    for (const s of Array.isArray(payload.subtasks) ? payload.subtasks : []) {
      newIds.set(s.id, await insertRow(db, 'tasks', s, { userId, override: { parentTaskId: mainId, shareToken: await freeToken(s) } }));
    }
    for (const [oldId, list] of Object.entries(payload.tags || {})) {
      for (const tag of list) await db.query('INSERT INTO task_tags ("taskId", tag) VALUES ($1, $2)', [newIds.get(Number(oldId)), tag]);
    }
    for (const [oldId, list] of Object.entries(payload.comments || {})) {
      for (const c of list) {
        await db.query('INSERT INTO task_comments ("taskId", type, content, "createdAt") VALUES ($1, $2, $3, $4)',
          [newIds.get(Number(oldId)), c.type === 'system' ? 'system' : 'user', c.content, c.createdAt || new Date().toISOString()]);
      }
    }
    // Blocked-by links: the other end must still be one of this person's tasks.
    const mine = async (id) => (await db.query('SELECT 1 FROM tasks WHERE id=$1 AND "userId"=$2', [id, userId])).rows.length > 0;
    for (const d of Array.isArray(payload.dependencies) ? payload.dependencies : []) {
      const a = newIds.get(d.taskId) ?? d.taskId;
      const b = newIds.get(d.blockedByTaskId) ?? d.blockedByTaskId;
      if (a === b || !(await mine(a)) || !(await mine(b))) continue;
      await db.query('INSERT INTO task_dependencies ("taskId", "blockedByTaskId") VALUES ($1, $2) ON CONFLICT DO NOTHING', [a, b]);
    }
    for (const f of Array.isArray(payload.attachments) ? payload.attachments : []) {
      const to = newIds.get(f.entityId);
      if (to && Number.isInteger(f.id)) {
        await db.query(`UPDATE attachments SET "entityId"=$1 WHERE id=$2 AND "userId"=$3 AND "entityType"='task'`, [to, f.id, userId]);
      }
    }
    return { entityId: mainId };
  },
  // Gone for good (30 days, deleted forever, bin emptied): remove the files too.
  async discard(db, userId, payload) {
    const fileIds = ids((payload?.attachments || []).map((f) => f.id));
    if (!fileIds.length) return;
    const { rows } = await db.query(`SELECT id, "storedPath" FROM attachments WHERE id = ANY($1::int[]) AND "userId"=$2 AND "entityType"='task'`, [fileIds, userId]);
    for (const a of rows) {
      try { if (fs.existsSync(a.storedPath)) fs.unlinkSync(a.storedPath); } catch { /* the row goes anyway */ }
    }
    await db.query(`DELETE FROM attachments WHERE id = ANY($1::int[]) AND "userId"=$2 AND "entityType"='task'`, [rows.map((r) => r.id), userId]);
  },
});

// ── Goals (an objective with its key results) ───────────────────────────────

/** The objective, its key results, and which tasks were linked to them (the delete unlinks those tasks, a restore links them again). */
async function snapshotObjective(db, userId, objectiveId) {
  const { rows } = await db.query('SELECT * FROM objectives WHERE id=$1 AND "userId"=$2 FOR UPDATE', [objectiveId, userId]);
  const objective = rows[0];
  if (!objective) return null;
  const keyResults = (await db.query('SELECT * FROM key_results WHERE "objectiveId"=$1 ORDER BY id', [objectiveId])).rows;
  const linkedTasks = keyResults.length
    ? (await db.query('SELECT id, "keyResultId" FROM tasks WHERE "userId"=$1 AND "keyResultId" = ANY($2::int[])', [userId, keyResults.map((k) => k.id)])).rows
    : [];
  return {
    title: objective.title,
    detail: `${keyResults.length} key result${keyResults.length === 1 ? '' : 's'}${linkedTasks.length ? ` · ${linkedTasks.length} linked task${linkedTasks.length === 1 ? '' : 's'}` : ''}`,
    payload: { objective, keyResults, linkedTasks },
  };
}

register('goal', {
  label: 'Goal',
  async restore(db, userId, payload) {
    const o = payload?.objective;
    if (!o) throw new Error('This deleted goal has nothing to restore.');
    const objectiveId = await insertRow(db, 'objectives', o, { userId });
    const krIds = new Map();
    for (const k of Array.isArray(payload.keyResults) ? payload.keyResults : []) {
      krIds.set(k.id, await insertRow(db, 'key_results', k, { override: { objectiveId } }));
    }
    // Tasks that were linked go back to their key result, unless the person has linked them somewhere else meanwhile.
    for (const t of Array.isArray(payload.linkedTasks) ? payload.linkedTasks : []) {
      const kr = krIds.get(t.keyResultId);
      if (kr && Number.isInteger(t.id)) {
        await db.query('UPDATE tasks SET "keyResultId"=$1 WHERE id=$2 AND "userId"=$3 AND "keyResultId" IS NULL', [kr, t.id, userId]);
      }
    }
    return { entityId: objectiveId };
  },
});

module.exports = { snapshotTask, snapshotObjective };
