// node client/src/pages/bip/bipNote.test.mjs
// The note links back with the exact text the server searches for, skips facts BIP did not find, prefers a recorded decision,
// and keeps a business name with brackets from breaking the link.
import assert from 'node:assert/strict';
import { profileNoteBody, clientFromProfile, profileFacts, profilePath } from './bipNote.mjs';

const profile = {
  id: 12, domain: 'saleslogs.com.au', businessName: 'SalesLogs Pty Limited', scannedAt: '2026-11-20T00:00:00Z',
  cards: {
    entity: { businessName: 'SalesLogs Pty Limited', abn: '69 161 409 132', entityType: 'Australian Private Company', domain: 'saleslogs.com.au' },
    locations: [{ value: '1 Example St, Melbourne VIC' }],
    products: { description: 'Automotive SaaS.' },
    people: [{ name: 'Jane Smith', role: 'Director' }, { name: '', role: 'Nobody' }],
    reputation: { googlePlaces: { rating: 4.6, reviewCount: 31 } },
  },
  reconciliation: { fields: {
    phone: { values: [{ value: '03 9000 0000' }, { value: '03 9111 1111' }], decision: '03 9111 1111' },
    address: { values: [] },
  } },
};

const body = profileNoteBody(profile);
assert.ok(body.startsWith('From Business Profiler: [SalesLogs Pty Limited](/bip/12)'), body);
assert.ok(body.includes('](/bip/12)'), 'the server finds linked notes by this text');
assert.ok(body.includes('- **ABN:** 69 161 409 132'));
assert.ok(body.includes('- **Phone:** 03 9111 1111'), 'the recorded decision wins over the first value');
assert.ok(body.includes('- **Address:** 1 Example St, Melbourne VIC'), 'falls back to the Locations card');
assert.ok(body.includes('- **People:** Jane Smith — Director; Nobody'));
assert.ok(body.includes('4.6/5 from 31 Google reviews'));
assert.ok(body.includes('Automotive SaaS.'));

const sparse = profileNoteBody({ id: 3, domain: 'x.com', cards: { entity: { abn: 'Not found' } } });
assert.ok(!sparse.includes('ABN'), '"Not found" is left out, not written into the note');
assert.ok(sparse.startsWith('From Business Profiler: [x.com](/bip/3)'), 'the domain names the link when there is no business name');

assert.ok(profileNoteBody({ id: 4, businessName: 'A [B] C', cards: {} }).startsWith('From Business Profiler: [A B C](/bip/4)'), 'brackets cannot break the link');
assert.equal(profileFacts({}).name, 'Business profile');
assert.equal(profilePath('7'), '/bip/7');

const c = clientFromProfile(profile);
assert.equal(c.name, 'SalesLogs Pty Limited');
assert.equal(c.status, 'prospect');
assert.equal(c.clientType, 'company');
assert.ok(c.notes.startsWith('Business Profiler profile: /bip/12'));
assert.ok(c.notes.includes('ABN: 69 161 409 132'));

console.log('bipNote.test.mjs: all passed');
