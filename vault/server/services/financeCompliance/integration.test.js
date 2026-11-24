'use strict';

// Wiring checks for the Finance Compliance Advisory. Kept as text assertions so the test needs no PostgreSQL,
// no browser and no AI key — the same way the other Finance guide/route parity tests work.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { FINANCE, SHARES, configFor } = require('../complianceAdvisory/config');

const root = path.join(__dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const db = read('server/db.js');
const index = read('server/index.js');
const manifest = JSON.parse(read('server/testing/routeManifest.json'));
const page = read('client/src/pages/FinancePage.jsx');
const tabUi = read('client/src/components/finance/FinanceComplianceTab.jsx');
const tour = read('client/src/utils/tours/financeTour.js');
const tutor = read('server/services/financeTutor.js');
const adapters = read('server/services/recycleBin/adapters/index.js');
const pkg = JSON.parse(read('package.json'));

assert.notStrictEqual(FINANCE.tables.reports, SHARES.tables.reports, 'Finance has its own history table');
assert.notStrictEqual(FINANCE.tables.sources, SHARES.tables.sources, 'Finance has its own source snapshot table');
assert.strictEqual(configFor('finance'), FINANCE);
assert.match(db, /CREATE TABLE IF NOT EXISTS finance_compliance_reports/, 'report table is created');
assert.match(db, /CREATE TABLE IF NOT EXISTS finance_compliance_sources/, 'source table is created');
assert.match(db, /idx_finance_compliance_reports_user_created/, 'report index is created');
assert.match(db, /idx_finance_compliance_sources_report/, 'source index is created');
assert.match(db, /REFERENCES finance_compliance_reports\(id\) ON DELETE CASCADE/, 'snapshots cascade with their report');

const mount = "app.use('/api/finance/compliance', requireFeature('finance'), requireAdmin, require('./routes/financeCompliance'))";
assert.ok(index.includes(mount), 'the compliance API is admin-only and feature-gated');
assert.ok(index.indexOf(mount) < index.indexOf("app.use('/api/finance', requireFeature('finance')"), 'mounted before /api/finance');
assert.ok(index.includes("require('./routes/financeCompliance')"), 'the Finance compliance router exists');
assert.ok(index.includes('startFinanceComplianceCron()'), 'the monthly Finance cron starts');
assert.ok(index.indexOf('startFinanceComplianceCron()') > 0);

for (const [method, suffix] of [
  ['GET', '/reports'],
  ['POST', '/reports'],
  ['GET', '/reports/:id'],
  ['DELETE', '/reports/:id'],
  ['GET', '/reports/:id/markdown'],
  ['GET', '/reports/:id/pdf'],
]) {
  const key = `${method} /api/finance/compliance${suffix}`;
  assert.strictEqual(manifest.routes[key]?.class, 'admin', `${key} is admin-only in the route manifest`);
}

assert.match(adapters, /require\('\.\/financeCompliance'\)/, 'Finance reports restore from the recycle bin');
assert.match(pkg.scripts['test:finance-compliance'], /integration\.test\.js/, 'test script runs the wiring checks');

assert.ok(page.includes("import FinanceComplianceTab from '../components/finance/FinanceComplianceTab'"), 'the tab component is imported');
assert.ok(page.includes("const ADMIN_ONLY_TABS = new Set(['Compliance'])"), 'non-admins cannot see Compliance');
assert.ok(page.includes("{tab === 'Compliance' && isAdmin && <FinanceComplianceTab />}"), 'the tab is admin-gated');
assert.ok(page.includes("{ name: 'Tax & reports', tabs: ['BAS', 'Reports', 'Compliance'] }"), 'the tab has a group');
assert.match(page, /^\s{2}Compliance: \{/m, 'the tab has help text');
assert.ok(tabUi.includes("'/api/finance/compliance/reports'"), 'the tab uses the Finance API');

assert.match(tour, /isAdmin \? TOTAL_STEPS \+ 1 : TOTAL_STEPS/, 'admins get one extra tour step');
assert.match(tour, /id: 'finance-compliance'/, 'the tour explains Compliance to admins');
assert.match(tour, /if \(isAdmin\) \{/, 'the extra step is conditional');

assert.match(tutor, /\{ id: 'Compliance', group: 'Admin'/, 'the guide knows the tab');
assert.match(tutor, /The Compliance tab is admin-only/, 'the guide explains the admin gate');

console.log('financeCompliance/integration: ok');
