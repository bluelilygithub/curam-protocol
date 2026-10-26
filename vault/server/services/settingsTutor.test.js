'use strict';

// node server/services/settingsTutor.test.js   (npm run test:settings-tutor). No model is called.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { checkBasics } = require('./guideBasicsKit');
const service = require('./settingsTutor');

(async () => {
  // ---- the guide knows exactly the sections Settings shows, and says which group each is in ----
  const { SETTINGS_GROUPS } = await import(pathToFileURL(path.join(__dirname, '../../client/src/utils/settingsGroups.mjs')).href);
  const settingsIds = SETTINGS_GROUPS.flatMap((g) => g.tabs.map((t) => t.id));
  const catalogSettings = service.CATALOG.filter((t) => !t.id.startsWith('admin-'));
  assert.deepStrictEqual(catalogSettings.map((t) => t.id).sort(), [...settingsIds].sort(), 'guide catalogue matches the Settings sections');
  for (const g of SETTINGS_GROUPS) {
    for (const t of g.tabs) {
      const entry = service.CATALOG.find((c) => c.id === t.id);
      assert.strictEqual(entry.group, g.label, `${t.id} is in the same group as the menu`);
      // anything only an admin sees must say so, so a member is never sent to a section they cannot open
      if (g.admin || t.admin) assert.match(`${entry.does} ${entry.notes}`, /Admin only/, `${t.id} says it is admin only`);
    }
  }

  // ---- the Admin page parts the guide mentions are all really there ----
  const pages = path.join(__dirname, '../../client/src/pages');
  const admin = fs.readFileSync(path.join(pages, 'AdminPage.jsx'), 'utf8');
  for (const needle of ['Dashboard', 'ClaudeWindowMonitor', 'SessionMonitor', 'SentryPanel', 'UsersAdminPanel', 'Tool Update Report', 'Backups']) {
    assert.ok(admin.includes(needle), `the Admin page still has ${needle}`);
  }
  assert.deepStrictEqual(service.CATALOG.filter((t) => t.id.startsWith('admin-')).map((t) => t.id).sort(),
    ['admin-backups', 'admin-dashboard', 'admin-errors', 'admin-monitors', 'admin-update-report', 'admin-users']);
  for (const f of ['SettingsPage.jsx', 'AdminPage.jsx']) {
    assert.ok(fs.readFileSync(path.join(pages, f), 'utf8').includes('<SettingsTutorChat'), `${f} shows the guide`);
  }

  const gaps = service.NOT_POSSIBLE.join(' ');
  for (const re of [/never shows values/, /Reading anyone's password/, /sign up/, /switched off/, /cannot see them/]) assert.match(gaps, re);
  const rules = service.RULES.join(' ');
  for (const re of [/no public sign-up/i, /can only turn a feature off/, /Admins always keep access/]) assert.match(rules, re);

  await checkBasics({
    name: 'settingsTutor', service, askName: 'askSettingsTutor', feature: 'settings_guide', toolWord: 'section',
    exampleToolId: 'Members', exampleStepId: 'Feature Access', system: [/admins only/, /cannot see any setting, key, password/],
  });
})().catch((e) => { console.error(e); process.exit(1); });
