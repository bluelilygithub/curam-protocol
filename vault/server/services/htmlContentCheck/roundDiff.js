'use strict';

// Stores each page's changes in its round row's results.diff (docs/html-content-check.md, "Changes"). Since milestone 4b a round has one
// row per page; each page is compared with its own reads only:
//   { v, baselineNumber, previousNumber, vsBaseline: { changes, stats } | null, vsPrevious: { changes, stats } }
// against that page's starting point (the first round in which the page was read) and against the last earlier round in which it was
// read (failed reads are skipped). vsBaseline is null when the two are the same round (not stored twice); reading a round fills it back.
// Worked out when a round is kept, and filled in later for any row that has none or an older version, in round order per page so the
// 'rotating' check sees what earlier rounds took off that page.

const { diffSnapshots, goneTexts, DIFF_VERSION } = require('./diff');

/** Makes sure every ready page row up to round `upTo` (all when omitted) has a current results.diff. `db` may be a pool or a client. */
async function ensureDiffs(db, userId, jobId, upTo = null) {
  const { rows } = await db.query(
    `SELECT "pageId", number, results->'diff'->>'v' AS v FROM content_check_rounds
      WHERE "jobId" = $1 AND "userId" = $2 AND status = 'ready' AND ($3::int IS NULL OR number <= $3) ORDER BY "pageId", number`,
    [jobId, userId, upTo]);
  const pagesToDo = new Set();
  const seen = new Set();
  for (const r of rows) { if (seen.has(r.pageId) && Number(r.v) !== DIFF_VERSION) pagesToDo.add(r.pageId); seen.add(r.pageId); }
  let done = 0;
  for (const pageId of pagesToDo) {
    const { rows: full } = await db.query(
      `SELECT number, snapshot, results FROM content_check_rounds
        WHERE "jobId" = $1 AND "userId" = $2 AND "pageId" = $3 AND status = 'ready' AND ($4::int IS NULL OR number <= $4) ORDER BY number`,
      [jobId, userId, pageId, upTo]);
    const gone = new Set();
    for (let i = 1; i < full.length; i++) {
      const cur = full[i];
      const prev = full[i - 1];
      const base = full[0];
      let diff = cur.results?.diff;
      if (!diff || diff.v !== DIFF_VERSION) {
        const vsPrevious = diffSnapshots(prev.snapshot, cur.snapshot, { goneTexts: gone });
        const vsBaseline = prev === base ? null : diffSnapshots(base.snapshot, cur.snapshot, { goneTexts: gone });
        diff = { v: DIFF_VERSION, baselineNumber: base.number, previousNumber: prev.number, vsBaseline, vsPrevious };
        await db.query(`UPDATE content_check_rounds SET results = COALESCE(results, '{}'::jsonb) || jsonb_build_object('diff', $4::jsonb)
                         WHERE "jobId" = $1 AND "pageId" = $2 AND number = $3`, [jobId, pageId, cur.number, JSON.stringify(diff)]);
        done++;
      }
      goneTexts(diff.vsPrevious, gone);
    }
  }
  return done;
}

module.exports = { ensureDiffs };
