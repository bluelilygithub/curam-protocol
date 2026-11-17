'use strict';

// How the recycle bin handles Translate: a deleted translation ('translate-job') and a deleted glossary ('translate-glossary').
// The delete routes (server/routes/translate.js) snapshot the row with snapshotJob() / the glossary row and call moveToBin();
// this puts them back. Neither has child tables. See docs/recycle-bin.md and docs/translate-agent.md.
//
// A translation keeps its files in the row itself (BYTEA: the original, the translated PDF, the Word/Excel copy), so unlike other
// tools the files ARE part of the snapshot, as base64 text. That is why this kind asks for more room than the default 5 MB
// (JOB_MAX_BYTES); a translation bigger than that is refused by the delete route, which then offers to delete it for good.

const { register } = require('../index');
const { insertRow } = require('../rowRestore');

const JOB_TYPE = 'translate-job';
const GLOSSARY_TYPE = 'translate-glossary';
const JOB_MAX_BYTES = 40 * 1024 * 1024;
const JOB_FILE_COLUMNS = ['originalPdf', 'translatedPdf', 'translatedFile'];
const JOB_JSONB_COLUMNS = ['sourceTextJson', 'intakeAnswers'];

const PASS_JSONB_COLUMNS = ['partIndexes', 'requirements', 'changedIndexes', 'translatedByPage', 'qaSummary'];

/** The job row as it goes into the bin, with its versions (passes): file columns turned into base64 text so they survive as JSON. */
function snapshotJob(row, passes = []) {
  const job = { ...row };
  for (const col of JOB_FILE_COLUMNS) if (Buffer.isBuffer(job[col])) job[col] = { base64: job[col].toString('base64') };
  return { job, passes };
}

register(JOB_TYPE, {
  label: 'Translation',
  async restore(db, userId, payload) {
    const job = payload?.job;
    if (!job || !job.filename) throw new Error('This deleted translation has nothing to restore.');
    const override = {};
    for (const col of JOB_FILE_COLUMNS) override[col] = job[col]?.base64 ? Buffer.from(job[col].base64, 'base64') : null;
    // JSONB goes in as text: the driver would turn a JavaScript array into a Postgres array instead of JSON
    for (const col of JOB_JSONB_COLUMNS) override[col] = job[col] == null ? null : JSON.stringify(job[col]);
    // the glossary it used may have been deleted since: insertRow leaves that link empty rather than failing
    const entityId = await insertRow(db, 'translate_jobs', job, { userId, override });
    // Its versions (passes), if it had any: a pass still marked running when it was deleted comes back as stopped.
    for (const p of Array.isArray(payload.passes) ? payload.passes : []) {
      const o = { jobId: entityId, status: p.status === 'running' ? 'failed' : p.status };
      for (const col of PASS_JSONB_COLUMNS) o[col] = p[col] == null ? null : JSON.stringify(p[col]);
      await insertRow(db, 'translate_job_passes', p, { userId, override: o, keepId: false });
    }
    return { entityId };
  },
});

register(GLOSSARY_TYPE, {
  label: 'Translate glossary',
  async restore(db, userId, payload) {
    const g = payload?.glossary;
    if (!g || !g.name) throw new Error('This deleted glossary has nothing to restore.');
    const override = { terms: JSON.stringify(Array.isArray(g.terms) ? g.terms : []) };
    // There can be only one learned glossary per language. If Translate has started a new one since this was deleted, the old
    // one comes back as an ordinary glossary (its words are all there; pick it under More options, or copy words across).
    if (g.isGlobal && g.targetLanguage) {
      const { rows } = await db.query(
        `SELECT 1 FROM translate_glossaries WHERE "userId" = $1 AND "targetLanguage" = $2 AND "isGlobal" = TRUE`, [userId, g.targetLanguage]);
      if (rows.length) { override.isGlobal = false; override.name = `${g.name} (restored)`; }
    }
    const entityId = await insertRow(db, 'translate_glossaries', g, { userId, override });
    return { entityId };
  },
});

// A house style (workspace-wide, admin only): the set and its examples, back under the same id when it is free.
register('translate-style-set', {
  label: 'Translate house style',
  async restore(db, userId, payload) {
    const set = payload?.set;
    if (!set || !set.name) throw new Error('This deleted house style has nothing to restore.');
    const entityId = await insertRow(db, 'translate_style_sets', set, { userId });
    let order = 0;
    for (const e of Array.isArray(set.examples) ? set.examples : []) {
      await insertRow(db, 'translate_style_examples', e, { userId, keepId: false, override: { setId: entityId, sortOrder: order++ } });
    }
    return { entityId };
  },
});

module.exports = { JOB_TYPE, GLOSSARY_TYPE, JOB_MAX_BYTES, snapshotJob };
