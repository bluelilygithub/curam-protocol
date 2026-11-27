'use strict';

// How the recycle bin handles a Shares watchlist company (Shares → Watchlist). DELETE /api/shares/watchlist/:id moves it and its
// research reports here in one transaction. See docs/recycle-bin.md and docs/shares-watchlist.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

register('share-watch', {
  label: 'Watchlist company',
  async restore(db, userId, payload) {
    const w = payload?.watch;
    if (!w?.symbol) throw new Error('This deleted watchlist entry has nothing to restore.');
    const clash = await db.query('SELECT 1 FROM share_watchlist WHERE "userId"=$1 AND symbol=$2 AND exchange=$3', [userId, w.symbol, w.exchange]);
    if (clash.rows.length) throw new RestoreError(`${w.symbol} is already on your watchlist. Remove that one first.`, 409);
    const watchId = await insertRow(db, 'share_watchlist', w, { userId });
    for (const r of Array.isArray(payload.reports) ? payload.reports : []) {
      // pg would send an array as a Postgres array, so send JSON text.
      await insertRow(db, 'share_research_reports', r, { userId, override: { watchId, sources: JSON.stringify(r.sources ?? []) } });
    }
    return { entityId: watchId };
  },
});
