'use strict';

// Stores each round's changes in results.diff (docs/html-content-check.md, "Changes"):
//   { v, baselineNumber, previousNumber, vsBaseline: { changes, stats }, vsPrevious: { changes, stats } }
// against the starting point (the first round that was read) and against the round before (the last earlier round that was read; failed
// rounds are skipped). Worked out when a round is kept, and filled in later for any round that has none or an older version (rounds kept
// before milestone 3), in round order so the 'rotating' check sees what earlier rounds took off the page.

const { diffSnapshots, goneTexts, DIFF_VERSION } = require('./diff');

/** Makes sure every ready round up to `upTo` (all when omitted) has a current results.diff. `db` may be a pool or a client in a transaction. */
async function ensureDiffs(db, userId, jobId, upTo = null) {
  const { rows } = await db.query(
    `SELECT number, results->'diff'->>'v' AS v FROM content_check_rounds
      WHERE "jobId" = $1 AND "userId" = $2 AND status = 'ready' AND ($3::int IS NULL OR number <= $3) ORDER BY number`,
    [jobId, userId, upTo]);
  if (rows.length < 2 || rows.slice(1).every((r) => Number(r.v) === DIFF_VERSION)) return 0;
  // something to do: read the snapshots once, then work forwards
  const { rows: full } = await db.query(
    `SELECT number, snapshot, results FROM content_check_rounds
      WHERE "jobId" = $1 AND "userId" = $2 AND status = 'ready' AND ($3::int IS NULL OR number <= $3) ORDER BY number`,
    [jobId, userId, upTo]);
  const gone = new Set();
  let done = 0;
  for (let i = 1; i < full.length; i++) {
    const cur = full[i];
    const prev = full[i - 1];
    const base = full[0];
    let diff = cur.results?.diff;
    if (!diff || diff.v !== DIFF_VERSION) {
      const vsPrevious = diffSnapshots(prev.snapshot, cur.snapshot, { goneTexts: gone });
      const vsBaseline = prev === base ? vsPrevious : diffSnapshots(base.snapshot, cur.snapshot, { goneTexts: gone });
      diff = { v: DIFF_VERSION, baselineNumber: base.number, previousNumber: prev.number, vsBaseline, vsPrevious };
      await db.query(`UPDATE content_check_rounds SET results = COALESCE(results, '{}'::jsonb) || jsonb_build_object('diff', $3::jsonb)
                       WHERE "jobId" = $1 AND number = $2`, [jobId, cur.number, JSON.stringify(diff)]);
      cur.results = { ...(cur.results || {}), diff };
      done++;
    }
    goneTexts(diff.vsPrevious, gone);
  }
  return done;
}

module.exports = { ensureDiffs };
