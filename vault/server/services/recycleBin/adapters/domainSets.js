'use strict';

// How the recycle bin handles a Domain page set. The delete route (server/routes/domains.js) snapshots the whole row and calls
// moveToBin(); this says how to put it back. A set has no child tables, so the row is the whole payload. See docs/recycle-bin.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');
const { MAX_SETS_PER_USER } = require('../../domainSets');

register('domain-set', {
  label: 'Domain set',
  async restore(db, userId, payload) {
    const s = payload?.set;
    if (!s || !s.name) throw new Error('This deleted set has nothing to restore.');
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM domain_sets WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_SETS_PER_USER) throw new RestoreError(`You already have ${MAX_SETS_PER_USER} saved sets. Delete some to bring this one back.`, 409);
    // JSONB goes in as text: the driver would turn a JavaScript array into a Postgres array instead of JSON
    const entityId = await insertRow(db, 'domain_sets', s, { userId, override: { data: JSON.stringify(s.data || {}) } });
    return { entityId };
  },
});
