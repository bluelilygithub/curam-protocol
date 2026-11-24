'use strict';

// How the recycle bin puts back a deleted Shares Compliance report (report row + source snapshots).
// DELETE /api/shares/compliance/reports/:id moves both in one transaction. See docs/recycle-bin.md and
// docs/shares-compliance.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

register('shares-compliance-report', {
  label: 'Shares compliance report',
  async restore(db, userId, payload) {
    const r = payload?.report;
    if (!r?.generatedAt && !r?.summary) throw new RestoreError('This deleted report has nothing to restore.');
    const reportId = await insertRow(db, 'shares_compliance_reports', r, {
      userId,
      override: { report: JSON.stringify(r.report || {}) },
    });
    for (const s of Array.isArray(payload.sources) ? payload.sources : []) {
      await insertRow(db, 'shares_compliance_sources', s, { userId, override: { reportId } });
    }
    return { entityId: reportId };
  },
});
