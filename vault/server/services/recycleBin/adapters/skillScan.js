'use strict';

// How the recycle bin puts back a deleted Skill Scanner scan (one skill_scans row, report included).
// DELETE /api/skill-scan/scans/:id (server/services/skillScan/index.js) calls moveToBin().

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

register('skill-scan', {
  label: 'Skill scan',
  async restore(db, userId, payload) {
    const scan = payload?.scan;
    if (!scan?.source) throw new RestoreError('This deleted scan has nothing to restore.');
    const entityId = await insertRow(db, 'skill_scans', scan, {
      userId,
      override: { report: scan.report ? JSON.stringify(scan.report) : null, summary: scan.summary ? JSON.stringify(scan.summary) : null },
    });
    return { entityId };
  },
});
