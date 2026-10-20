'use strict';

// node server/services/pcHealthTutor.test.js   (npm run test:pc-health-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./pcHealthTutor');

checkGuide({
  name: 'pcHealthTutor',
  service,
  askName: 'askPcHealthTutor',
  feature: 'pc_health_guide',
  toolsFile: 'pcHealth/pcHealthTools.mjs',
  menuExport: 'PC_HEALTH_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'overview',
  exampleStepId: 'helper',
  facts: [
    ['overview', 'notes', /no delete, clean or fix button/, 'the overview has no fix button'],
    ['scan', 'does', /Waiting for the helper/, 'the waiting state is named as on the page'],
    ['scan-scope', 'does', /Large-file size.*Time limit/s, 'the scan settings are named as on the page'],
    ['logs', 'notes', /Windows manages the hibernation and page files/, 'system files are not offered as removals'],
    ['growth', 'notes', /at least two finished scans/, 'growth needs two scans'],
    ['helper', 'notes', /read-only/, 'the helper is read-only'],
    ['helper', 'does', /shown once/, 'the key is shown once'],
  ],
  gaps: [/Deleting, moving, cleaning up or fixing anything/, /different computer/, /real time/, /malware/, /SMART/, /without the helper|Running without the helper/],
  rules: [/only reports/, /read-only helper/, /only the admin account/],
  system: [/never fixes anything/, /never give a delete or cleanup command/],
}).catch((e) => { console.error(e); process.exit(1); });
