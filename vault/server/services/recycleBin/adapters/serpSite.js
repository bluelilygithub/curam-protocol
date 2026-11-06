'use strict';

// How the recycle bin handles a deleted SERP Tracker site. The delete (server/services/serpTracker/store.js deleteSite) snapshots the site and its
// saved lookups (without their raw DataForSEO answers) and calls moveToBin(); this puts them back. A site's run history is not kept (it is
// only a log of checks), and its past spending stays in the cost log either way. See docs/recycle-bin.md and docs/serp-tracker.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

const MAX_SITES_PER_USER = 20; // the same number the create route enforces

register('serp-site', {
  label: 'SERP Tracker site',
  async restore(db, userId, payload) {
    const s = payload?.site;
    const profile = s && (typeof s.profileJson === 'string' ? JSON.parse(s.profileJson) : s.profileJson);
    if (!profile || !profile.domain) throw new Error('This deleted site has nothing to restore.');
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM serp_sites WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_SITES_PER_USER) throw new RestoreError(`You already track ${MAX_SITES_PER_USER} sites. Delete one to bring this one back.`, 409);
    const same = await db.query(`SELECT 1 FROM serp_sites WHERE "userId" = $1 AND "profileJson"->>'domain' = $2`, [userId, profile.domain]);
    if (same.rows.length) throw new RestoreError(`You already track ${profile.domain} again, so this one cannot come back.`, 409);
    // JSONB values go in as text: the driver would turn an object into a Postgres array-style value otherwise. A client that has gone since is left empty.
    const siteId = await insertRow(db, 'serp_sites', s, { userId, override: { profileJson: JSON.stringify(profile) } });
    for (const l of payload.lookups || []) {
      // eslint-disable-next-line no-await-in-loop
      await insertRow(db, 'serp_lookups', l, { userId, override: { siteId, summaryJson: JSON.stringify(l.summaryJson), rawGz: null } });
    }
    return { entityId: siteId };
  },
});
