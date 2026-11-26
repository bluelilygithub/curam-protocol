'use strict';

// How the recycle bin puts back an HTML Content Check job. The delete route (server/routes/htmlContentCheck.js) snapshots the job with
// its pages, request lines, rounds (one row per page) and client notes; this restores them under the same ids when free, so a note still
// points at its line and a round row at its page. The returned report a note came from is a separate attachment: if it has gone since,
// the note comes back without it. A bin copy made before pages existed (milestone 4b) has no pages: the job's address becomes page 1.
// See docs/recycle-bin.md and docs/html-content-check.md.

const { register } = require('../index');
const { insertRow } = require('../rowRestore');

const json = (v) => (v == null ? v : JSON.stringify(v)); // JSONB goes in as text (the driver would mangle arrays otherwise)
const list = (v) => (Array.isArray(v) ? v : []);

register('html-content-check-job', {
  label: 'HTML Content Check job',
  async restore(db, userId, payload) {
    const job = payload?.job;
    if (!job || typeof job.name !== 'string' || typeof job.url !== 'string') throw new Error('This deleted job has nothing to restore.');
    const jobId = await insertRow(db, 'content_check_jobs', job, { userId, override: { settings: json(job.settings || {}) } });
    const pageIds = new Map();
    const pages = list(payload.pages).length ? list(payload.pages) : [{ id: null, url: job.url, position: 0, fetchMode: job.fetchMode || 'auto' }];
    for (const p of pages) pageIds.set(p.id, await insertRow(db, 'content_check_pages', p, { userId, override: { jobId } }));
    const firstPage = pageIds.get(pages[0].id);
    const itemIds = new Map();
    for (const it of list(payload.items)) {
      itemIds.set(it.id, await insertRow(db, 'content_check_items', it, { userId, override: { jobId, pageId: it.pageId == null ? null : pageIds.get(it.pageId) ?? null } }));
    }
    for (const r of list(payload.rounds)) {
      await insertRow(db, 'content_check_rounds', r, { userId, override: { jobId, pageId: pageIds.get(r.pageId) ?? firstPage, snapshot: json(r.snapshot), results: json(r.results || {}) } });
    }
    for (const n of list(payload.notes)) {
      await insertRow(db, 'content_check_client_notes', n, { userId, override: { jobId, itemId: itemIds.get(n.itemId) ?? null } });
    }
    return { entityId: jobId };
  },
});
