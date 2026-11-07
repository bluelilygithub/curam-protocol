'use strict';

// How the recycle bin handles a Shares thesis (Shares → Thesis). DELETE /api/shares/thesis/:id moves the thesis and its check history
// here in one transaction. See docs/recycle-bin.md and docs/shares-thesis.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

// The snapshot holds JSONB columns as parsed values; pg would send an array as a Postgres array, so send JSON text instead.
const asJson = (row, cols) => Object.fromEntries(cols.map((c) => [c, JSON.stringify(row?.[c] ?? (c === 'anchors' || c === 'thesisSnapshot' ? {} : []))]));

register('share-thesis', {
  label: 'Share thesis',
  async restore(db, userId, payload) {
    const t = payload?.thesis;
    if (!t?.symbol) throw new Error('This deleted thesis has nothing to restore.');
    const clash = await db.query(
      'SELECT 1 FROM share_theses WHERE "userId"=$1 AND symbol=$2 AND exchange=$3',
      [userId, t.symbol, t.exchange || '']
    );
    if (clash.rows.length) throw new RestoreError(`There is already a thesis for ${t.symbol}. Delete or edit that one first.`, 409);
    const thesisId = await insertRow(db, 'share_theses', t, { userId, override: asJson(t, ['assumptions', 'redLines', 'anchors']) });
    for (const c of Array.isArray(payload.checks) ? payload.checks : []) {
      await insertRow(db, 'share_thesis_checks', c, { userId, override: { thesisId, ...asJson(c, ['ratings', 'redLineHits', 'drift', 'thesisSnapshot']) } });
    }
    return { entityId: thesisId };
  },
});
