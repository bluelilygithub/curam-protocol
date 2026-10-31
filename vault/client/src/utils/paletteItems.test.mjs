import assert from 'node:assert/strict';
import { actionItems, appItems, settingItems, scoreItem, rankLocal, remoteItems, buildSections, readRecents, rememberChoice, asRecent, RECENTS_KEY } from './paletteItems.mjs';

const apps = appItems([
  { label: 'Workspace', items: [{ id: 'notes', label: 'Notes', path: '/notes', icon: 'pen-line' }, { id: 'showcase', label: 'Showcase', path: 'https://x', external: true }] },
  { label: 'Business', items: [{ id: 'clients', label: 'CRM', path: '/clients', icon: 'briefcase' }, { id: 'notes', label: 'Notes dup', path: '/notes' }] },
]);
assert.equal(apps.length, 2, 'external links and duplicates are dropped');

const settings = settingItems([{ label: 'You', tabs: [{ id: 'Appearance', tip: 'Theme, font' }, { id: 'Recycle bin', tip: 'Deleted things' }] }]);
assert.equal(settings[0].to, '/settings?tab=Appearance');
assert.equal(settings[1].to, '/settings?tab=Recycle%20bin');

// ranking
assert.ok(scoreItem({ title: 'Notes' }, 'notes') > scoreItem({ title: 'Release notes' }, 'notes'), 'exact beats word match');
assert.ok(scoreItem({ title: 'Release notes' }, 'notes') > scoreItem({ title: 'Footnotes' }, 'notes'), 'word start beats inside a word');
assert.equal(scoreItem({ title: 'Notes' }, ''), 0);
assert.equal(scoreItem({ title: 'Notes' }, 'zzz'), 0);
assert.ok(scoreItem({ title: 'Appearance', keywords: 'Theme, font' }, 'theme') > 0, 'keywords match');
assert.ok(scoreItem({ title: 'New task', keywords: 'todo add' }, 'add todo') > 0, 'several words in any order');

const all = [...actionItems(), ...apps, ...settings];
assert.equal(rankLocal(all, 'new')[0].key, 'new-note');
assert.equal(rankLocal(all, 'crm')[0].key, 'clients');
assert.ok(rankLocal(all, 'n', 1).filter((x) => x.kind === 'app').length <= 1, 'capped per kind');

// remote shaping and section order
const items = remoteItems({
  global: { notes: [{ id: 3, title: 'Plan', snippet: 'a b' }], clients: [{ id: 9, name: 'Acme', company: 'Acme Pty', status: 'paused' }], invoices: [{ id: 1, number: 'INV-1', status: 'paid', total: 10, docType: 'quote' }] },
  search: [{ type: 'message', title: 'Chat X', projectId: null, sessionId: 's1', snippet: '<mark>hi</mark> there' }],
  tasks: [{ id: 4, title: 'Call', status: 'open' }],
});
assert.equal(items.find((x) => x.kind === 'invoice').title, 'Quote INV-1');
assert.equal(items.find((x) => x.kind === 'message').subtitle, 'hi there', 'tags stripped');
assert.equal(items.find((x) => x.kind === 'message').event.detail, 's1');
const { sections, flat } = buildSections([...items, ...actionItems().slice(0, 1)]);
assert.deepEqual(sections.map((s) => s.kind), ['action', 'note', 'client', 'invoice', 'task', 'message']);
assert.equal(flat.length, items.length + 1);

// recents
const store = { d: {}, getItem(k) { return this.d[k] ?? null; }, setItem(k, v) { this.d[k] = v; } };
rememberChoice(store, apps[0]);
rememberChoice(store, settings[0]);
rememberChoice(store, apps[0]);
assert.deepEqual(readRecents(store).map((x) => x.key), ['notes', 'Appearance'], 'newest first, no repeats');
rememberChoice(store, asRecent(readRecents(store)[1]));
assert.equal(readRecents(store)[0].kind, 'setting', 'choosing a recent keeps its real kind');
store.d[RECENTS_KEY] = '{not json';
assert.deepEqual(readRecents(store), [], 'bad storage is ignored');
assert.deepEqual(readRecents(null), [], 'no storage is fine');
rememberChoice(null, apps[0]);

console.log('paletteItems: ok');
