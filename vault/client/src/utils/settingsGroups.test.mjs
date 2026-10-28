// node client/src/utils/settingsGroups.test.mjs
import assert from 'node:assert/strict';
import { SETTINGS_GROUPS, visibleGroups, allowedTabIds, filterGroups, groupOf, isFeatureGatedTab } from './settingsGroups.mjs';

let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error(`FAIL  ${name}\n   ${e.message}`); process.exitCode = 1; } };

// the sections the page had before the menu was grouped: none may go missing, none may be added by accident
const ORIGINAL_ADMIN = ['Appearance', 'Profile', 'AI & Chat', 'Translation', 'Tasks', 'Goals', 'Integrations', 'Shares', 'Amazon Search', 'Topic Research', 'Mobile', 'Navigation', 'Members', 'Feature Access', 'Wellbeing Invites', 'Content Restrictions', 'Tool Maintenance', 'Environment', 'Tours', 'Recycle bin', 'Vault Shelf'];

t('an admin sees exactly the original sections plus the Recycle bin and Vault Shelf, once each', () => {
  const ids = allowedTabIds(true);
  assert.deepEqual([...ids].sort(), [...ORIGINAL_ADMIN].sort());
  assert.equal(new Set(ids).size, ids.length);
});
t('a member sees only Appearance, Profile, Tasks and the Recycle bin, under one group', () => {
  assert.deepEqual(allowedTabIds(false), ['Appearance', 'Profile', 'Tasks', 'Recycle bin']);
  assert.equal(visibleGroups(false).length, 1);
});
t('Vault Shelf shows to a member only while the Shelf feature is on for them; admins always see it', () => {
  assert.ok(!allowedTabIds(false).includes('Vault Shelf'));
  assert.ok(!allowedTabIds(false, SETTINGS_GROUPS, { shelf: false }).includes('Vault Shelf'));
  assert.deepEqual(allowedTabIds(false, SETTINGS_GROUPS, { shelf: true }), ['Appearance', 'Profile', 'Tasks', 'Recycle bin', 'Vault Shelf']);
  assert.ok(allowedTabIds(true, SETTINGS_GROUPS, { shelf: false }).includes('Vault Shelf'));
  assert.ok(isFeatureGatedTab('Vault Shelf'));
  assert.ok(!isFeatureGatedTab('Profile'));
});
t('members never see an admin-only group', () => {
  const labels = visibleGroups(false).map((g) => g.label);
  for (const g of SETTINGS_GROUPS.filter((x) => x.admin)) assert.ok(!labels.includes(g.label), g.label);
});
t('every section has a description for its tooltip', () => {
  for (const g of SETTINGS_GROUPS) for (const tab of g.tabs) assert.ok(tab.tip && tab.tip.length > 10, tab.id);
});
t('search matches the name, the description or the group, ignoring case', () => {
  const all = visibleGroups(true);
  assert.deepEqual(filterGroups(all, 'FEATURE').flatMap((g) => g.tabs.map((x) => x.id)), ['Feature Access']);
  assert.ok(filterGroups(all, 'gmail').flatMap((g) => g.tabs.map((x) => x.id)).includes('Integrations'));
  assert.deepEqual(filterGroups(all, 'system').map((g) => g.id), ['system']);
});
t('blank search keeps everything; no match gives nothing', () => {
  const all = visibleGroups(true);
  assert.equal(filterGroups(all, '  '), all);
  assert.deepEqual(filterGroups(all, 'zzzzqq'), []);
});
t('groupOf finds the group, or null', () => {
  assert.equal(groupOf('Members').id, 'workspace');
  assert.equal(groupOf('Nope'), null);
});

console.log(process.exitCode ? 'Some checks FAILED' : `All ${passed} checks passed`);
