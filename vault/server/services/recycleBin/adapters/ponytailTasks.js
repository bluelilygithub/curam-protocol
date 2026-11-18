'use strict';

// How the recycle bin handles a Ponytail report task (admin, /ponytail). DELETE /api/ponytail/tasks/:id moves the row here.
// A task that is still running is sent again by Ponytail on its next turn, which makes a new row with the same key; restoring the old
// copy then answers 409. See docs/ponytail-report.md and docs/recycle-bin.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

register('ponytail-task', {
  label: 'Ponytail task',
  async restore(db, userId, payload) {
    const t = payload?.task;
    if (!t?.key) throw new Error('This deleted Ponytail task has nothing to restore.');
    const clash = await db.query('SELECT 1 FROM ponytail_tasks WHERE "userId"=$1 AND key=$2', [userId, t.key]);
    if (clash.rows.length) throw new RestoreError('Ponytail has sent this task again since it was deleted, so it is already in the report.', 409);
    return { entityId: await insertRow(db, 'ponytail_tasks', t, { userId }) };
  },
});
