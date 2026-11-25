'use strict';

// How the recycle bin puts back a deleted Geo-check run with its captures (server/services/geoCheck/jobs.js remove()). The pictures are
// attachments that stay on disk while the run is in the bin, and go (files and rows) when the bin lets it go for good.
// See docs/recycle-bin.md and docs/geo-check.md.

const { register } = require('../index');
const fs = require('fs');
const { insertRow } = require('../rowRestore');

const json = (v) => (v == null ? null : JSON.stringify(v));

register('geo-check-run', {
  label: 'Country check',
  async restore(db, userId, payload) {
    const run = payload && payload.run;
    if (!run || !run.url) throw new Error('This deleted country check has nothing to restore.');
    // JSONB values go in as text: the driver would turn an object into a Postgres array-style value otherwise
    const runId = await insertRow(db, 'geo_check_runs', run, { userId, override: { settings: json(run.settings), diff: json(run.diff) } });
    for (const c of payload.captures || []) {
      await insertRow(db, 'geo_check_captures', c, { userId, override: { runId, extract: json(c.extract) } });
    }
    return { entityId: runId };
  },
  // by attachment id (not capture id): a restored capture may have a new id, and an old capture id can belong to another run by then
  async discard(db, userId, payload) {
    const ids = ((payload && payload.captures) || []).map((c) => c.attachmentId).filter(Number.isInteger);
    if (!ids.length) return;
    const { rows } = await db.query(`DELETE FROM attachments WHERE id = ANY($1::int[]) AND "userId" = $2 AND "entityType" = 'geo-capture' RETURNING "storedPath"`, [ids, userId]);
    for (const a of rows) {
      try { fs.unlinkSync(a.storedPath); } catch { /* already gone */ }
    }
  },
});
