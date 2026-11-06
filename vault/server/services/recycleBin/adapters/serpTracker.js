'use strict';

// How the recycle bin handles a saved SERP Tracker lookup. The delete route (server/routes/serpTrackerRouter.js) snapshots the row WITHOUT its
// raw DataForSEO answer (big, and re-fetching it would cost money) and calls moveToBin(); this puts it back. The parsed summary, the
// cost and the date all come back; only the raw answer does not. See docs/recycle-bin.md and docs/serp-tracker.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

const MAX_LOOKUPS_PER_LIST = 50; // the same number the save keeps, per site (and for the Quick lookups)

register('serp-lookup', {
  label: 'SERP lookup',
  async restore(db, userId, payload) {
    const l = payload?.lookup;
    if (!l || !l.keyword || l.summaryJson == null) throw new Error('This deleted lookup has nothing to restore.');
    // the list it belongs to: its site (if that site is still the person's), else the Quick lookups
    const site = l.siteId == null ? null : (await db.query('SELECT id FROM serp_sites WHERE id = $1 AND "userId" = $2', [l.siteId, userId])).rows[0];
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM serp_lookups WHERE "userId" = $1 AND "siteId" IS NOT DISTINCT FROM $2::int', [userId, site ? site.id : null]);
    if (Number(rows[0]?.n ?? 0) >= MAX_LOOKUPS_PER_LIST) throw new RestoreError(`You already have ${MAX_LOOKUPS_PER_LIST} saved lookups in that list. Delete some to bring this one back.`, 409);
    const id = await insertRow(db, 'serp_lookups', l, {
      userId, // a JSONB value goes in as text: the driver would turn an object into a Postgres array-style value otherwise
      override: { summaryJson: JSON.stringify(l.summaryJson), rawGz: null },
    });
    return { entityId: id };
  },
});
