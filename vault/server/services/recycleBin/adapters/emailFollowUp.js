'use strict';

// How the recycle bin handles an Email Follow-Up case. The delete route (server/routes/emailFollowUp.js) snapshots the case, every source
// (message and attachment text), every draft with its approval records, and the Sent checks, then calls moveToBin(); this says how to put it
// all back. A case with a lot of attachment text can be big, so the item is allowed more than the default 5 MB (see CASE_BIN_MAX_BYTES);
// one bigger than that cannot be kept and the person is offered "Delete forever" instead. See docs/recycle-bin.md and docs/email-follow-up.md.
// Tasks made from a case's rows are the person's own to-dos and are NOT in the snapshot: they were never removed.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

const CASE_BIN_MAX_BYTES = 25 * 1024 * 1024;
const MAX_CASES_PER_USER = 500;

const json = (v) => (v == null ? null : JSON.stringify(v));

register('email-follow-up-case', {
  label: 'Email Follow-Up case',
  async restore(db, userId, payload) {
    const c = payload?.case;
    if (!c || !c.title) throw new Error('This deleted case has nothing to restore.');
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM ef_cases WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_CASES_PER_USER) throw new RestoreError(`You already have ${MAX_CASES_PER_USER} cases. Close or delete some to bring this one back.`, 409);

    // The case first (its client and project links are left empty automatically if either has gone since). JSONB values go in as text:
    // the driver would turn a JavaScript array into a Postgres array.
    const caseId = await insertRow(db, 'ef_cases', c, { userId, override: { aliases: json(c.aliases ?? []), governing: json(c.governing ?? []), ledger: json(c.ledger ?? []) } });

    // Sources keep their old ids when those are free (they nearly always are: ids are never reused), so the ledger's pointers still hold.
    // If one was taken, the pointers are rewritten below. Messages come before the attachments that hang off them (lower ids).
    const sourceIds = new Map();
    for (const s of [...(payload.sources || [])].sort((a, b) => a.id - b.id)) {
      // eslint-disable-next-line no-await-in-loop
      sourceIds.set(s.id, await insertRow(db, 'ef_sources', s, {
        userId, override: { caseId, parentId: s.parentId == null ? null : (sourceIds.get(s.parentId) ?? null), attachments: json(s.attachments ?? []) },
      }));
    }
    const moved = [...sourceIds].some(([from, to]) => from !== to);
    const remap = (id) => sourceIds.get(id) ?? id;

    const draftIds = new Map();
    for (const d of payload.drafts || []) {
      const content = moved && d.content && Array.isArray(d.content.claims)
        ? { ...d.content, claims: d.content.claims.map((cl) => (cl.anchor ? { ...cl, anchor: { ...cl.anchor, sourceId: remap(cl.anchor.sourceId) } } : cl)) }
        : d.content;
      // eslint-disable-next-line no-await-in-loop
      draftIds.set(d.id, await insertRow(db, 'ef_drafts', d, { userId, override: { caseId, previousId: null, content: json(content), verdict: json(d.verdict) } }));
    }
    for (const d of payload.drafts || []) {
      if (d.previousId && draftIds.has(d.previousId)) {
        // eslint-disable-next-line no-await-in-loop
        await db.query('UPDATE ef_drafts SET "previousId" = $1 WHERE id = $2', [draftIds.get(d.previousId), draftIds.get(d.id)]);
      }
    }
    for (const a of payload.approvals || []) {
      const draftId = draftIds.get(a.draftId);
      if (!draftId) continue;
      // eslint-disable-next-line no-await-in-loop
      await insertRow(db, 'ef_approvals', a, { userId, override: { draftId, acceptedWarnings: json(a.acceptedWarnings ?? []) } });
    }
    for (const w of payload.sweeps || []) {
      // eslint-disable-next-line no-await-in-loop
      await insertRow(db, 'ef_sent_sweeps', w, { userId, override: { caseId } });
    }

    if (moved) {
      const fix = (row) => ({
        ...row,
        anchors: (row.anchors || []).map((a) => ({ ...a, sourceId: remap(a.sourceId) })),
        evidence: (row.evidence || []).map(remap),
      });
      const ledger = (c.ledger || []).map(fix);
      await db.query('UPDATE ef_cases SET ledger = $1 WHERE id = $2', [json(ledger), caseId]);
    }
    return { entityId: caseId };
  },
});

module.exports = { CASE_BIN_MAX_BYTES };
