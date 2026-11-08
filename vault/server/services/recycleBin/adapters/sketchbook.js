'use strict';

// How the recycle bin handles Sketchbook. The delete route (server/routes/sketchbook.js) snapshots the row and calls moveToBin(); this puts
// it back. A sketch has no child tables (its earlier pictures live in its own `versions` column), so the row is the whole payload.
// See docs/recycle-bin.md and docs/sketchbook.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');
const { MAX_SKETCHES_PER_USER, checkImage } = require('../../sketchbook');

register('sketch', {
  label: 'Sketch',
  async restore(db, userId, payload) {
    const s = payload?.sketch;
    if (!s || typeof s.image !== 'string') throw new Error('This deleted sketch has nothing to restore.');
    checkImage(s.image); // a picture that no longer passes today's checks is refused rather than put back broken
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM sketches WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_SKETCHES_PER_USER) throw new RestoreError(`You already have ${MAX_SKETCHES_PER_USER} sketches. Delete some to bring this one back.`, 409);
    const entityId = await insertRow(db, 'sketches', s, { userId });
    return { entityId };
  },
});
