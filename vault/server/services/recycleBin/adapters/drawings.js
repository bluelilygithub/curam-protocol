'use strict';

// How the recycle bin handles Drawings. The delete route (server/routes/drawings.js) snapshots the row and calls moveToBin(); this puts it
// back. A drawing has no child tables, so the row (scene included) is the whole payload. See docs/recycle-bin.md and docs/drawings.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');
const { MAX_DRAWINGS_PER_USER, checkScene } = require('../../drawings');

register('drawing', {
  label: 'Drawing',
  async restore(db, userId, payload) {
    const d = payload?.drawing;
    if (!d || typeof d.scene !== 'string') throw new Error('This deleted drawing has nothing to restore.');
    checkScene(d.scene); // a scene that no longer passes today's checks is refused rather than put back broken
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM drawings WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_DRAWINGS_PER_USER) throw new RestoreError(`You already have ${MAX_DRAWINGS_PER_USER} drawings. Delete some to bring this one back.`, 409);
    const entityId = await insertRow(db, 'drawings', d, { userId });
    return { entityId };
  },
});
