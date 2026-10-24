'use strict';

// How the recycle bin handles Route Tracer tracks. The delete routes (server/routes/routeTracksRouter.js) snapshot the whole row
// and call moveToBin(); this says how to put it back. A track has no child tables, so the row is the whole payload.
// See docs/recycle-bin.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

const MAX_TRACKS_PER_USER = 1000; // same limit the create route enforces

register('route-track', {
  label: 'Route track',
  async restore(db, userId, payload) {
    const t = payload?.track;
    if (!t || !t.geometry) throw new Error('This deleted track has nothing to restore.');
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM route_tracks WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_TRACKS_PER_USER) throw new RestoreError(`You already have ${MAX_TRACKS_PER_USER} tracks. Delete some to bring this one back.`, 409);
    // JSONB values go in as text: the driver would turn a JavaScript array (the directions) into a Postgres array instead of JSON
    const entityId = await insertRow(db, 'route_tracks', t, {
      userId,
      override: { geometry: JSON.stringify(t.geometry), cues: t.cues == null ? null : JSON.stringify(t.cues) },
    });
    return { entityId };
  },
});
