'use strict';

// How the recycle bin puts back a saved DNS Lookup answer. The delete route (server/routes/dnsLookup.js) snapshots the whole row.
// See docs/recycle-bin.md and docs/dns-lookup.md.

const { register } = require('../index');
const { insertRow } = require('../rowRestore');

register('dns-lookup', {
  label: 'DNS lookup',
  async restore(db, userId, payload) {
    const l = payload?.lookup;
    if (!l || !l.name || l.result == null) throw new Error('This deleted lookup has nothing to restore.');
    // a JSONB value goes in as text: the driver would turn an object into a Postgres array-style value otherwise
    const id = await insertRow(db, 'dns_lookups', l, { userId, override: { result: JSON.stringify(l.result) } });
    return { entityId: id };
  },
});
