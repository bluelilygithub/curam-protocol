'use strict';

// Recycle-bin restore for either compliance report table. The deleted payload holds the report row (minus its
// id, which insertRow may reuse) and every source snapshot. It is registered from the shared adapter index.
// See docs/recycle-bin.md and docs/shares-compliance.md.

const { register, RestoreError } = require('../recycleBin');
const { insertRow } = require('../recycleBin/rowRestore');

function createRecycleAdapter(config) {
  const label = config.recycleLabel || `${config.appLabel} compliance report`;

  async function restore(db, userId, payload) {
    const report = payload?.report;
    if (!report?.generatedAt && !report?.summary) throw new RestoreError('This deleted report has nothing to restore.');
    const reportId = await insertRow(db, config.tables.reports, report, {
      userId,
      override: { report: JSON.stringify(report.report || {}) },
    });
    for (const source of Array.isArray(payload.sources) ? payload.sources : []) {
      await insertRow(db, config.tables.sources, source, { userId, override: { reportId } });
    }
    return { entityId: reportId };
  }

  register(config.recycleType, { label, restore });
  return { type: config.recycleType, label, restore };
}

module.exports = { createRecycleAdapter };
