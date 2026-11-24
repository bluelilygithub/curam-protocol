'use strict';

// Shared configuration for the two admin compliance advisories (Shares and Finance). Both watch the same fixed
// ATO allow-list and behave the same way; only the app name, wording, API mount, tables, usage feature, spend
// env vars, recycle-bin type and cron lock name differ. See docs/shares-compliance.md and docs/finance-compliance.md.

const SHARES = Object.freeze({
  app: 'shares',
  title: 'Shares Compliance Advisory',
  appLabel: 'Shares',
  context: 'personal share portfolio',
  focus: 'how a personal share portfolio is recorded, reported or checked',
  recordNoun: 'share records',
  disclaimer: 'General information only, not tax or legal advice. Check the linked ATO page for the exact wording and date, and confirm what applies to you with your accountant.',
  apiBase: '/api/shares/compliance',
  tables: Object.freeze({
    reports: 'shares_compliance_reports',
    sources: 'shares_compliance_sources',
  }),
  feature: 'shares_compliance_report',
  envPrefix: 'SHARES_COMPLIANCE',
  recycleType: 'shares-compliance-report',
  recycleLabel: 'Shares compliance report',
  cronName: 'shares-compliance',
  logPrefix: 'shares-compliance',
});

const FINANCE = Object.freeze({
  app: 'finance',
  title: 'Finance Compliance Advisory',
  appLabel: 'Finance',
  context: 'personal and small-business finance records',
  focus: 'how personal and small-business finance records are recorded, reported or checked',
  recordNoun: 'finance records',
  disclaimer: 'General information only, not tax or legal advice. Check the linked ATO page for the exact wording and date, and confirm what applies to you with your accountant.',
  apiBase: '/api/finance/compliance',
  tables: Object.freeze({
    reports: 'finance_compliance_reports',
    sources: 'finance_compliance_sources',
  }),
  feature: 'finance_compliance_report',
  envPrefix: 'FINANCE_COMPLIANCE',
  recycleType: 'finance-compliance-report',
  recycleLabel: 'Finance compliance report',
  cronName: 'finance-compliance',
  logPrefix: 'finance-compliance',
});

const CONFIGS = Object.freeze({ shares: SHARES, finance: FINANCE });

function configFor(app) {
  const key = String(app || '').toLowerCase();
  if (!CONFIGS[key]) throw new Error(`Unknown compliance advisory app: ${app}`);
  return CONFIGS[key];
}

module.exports = { SHARES, FINANCE, CONFIGS, configFor };
