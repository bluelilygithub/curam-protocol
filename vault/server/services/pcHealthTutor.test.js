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
    ['overview', 'does', /Copy with explanations/, 'the copy buttons are named as on the page'],
    ['overview', 'does', /More info toggle/, 'the More info toggle is named as on the page'],
    ['overview', 'notes', /advice for you to weigh, never actions/, 'advice is not an action'],
    ['scan', 'does', /Waiting for the helper/, 'the waiting state is named as on the page'],
    ['scan-scope', 'does', /Large-file size.*Time limit/s, 'the scan settings are named as on the page'],
    ['logs', 'notes', /Windows manages the hibernation and page files/, 'system files are not offered as removals'],
    ['growth', 'notes', /at least two finished scans/, 'growth needs two scans'],
    ['helper', 'notes', /Scanning is read-only/, 'scanning is read-only'],
    ['cleanup', 'does', /Temp folder.*npm, pip and Yarn/s, 'the fixed list is named'],
    ['cleanup', 'notes', /Nothing else is ever offered/, 'nothing else is offered'],
    ['cleanup', 'notes', /does not use the Recycle Bin/, 'deletion is permanent'],
    ['cleanup-allow', 'does', /-AllowCleanup/, 'the second lock is named'],
    ['helper', 'does', /shown once/, 'the key is shown once'],
    ['helper', 'does', /cd line/, 'the folder step is named'],
    ['helper', 'does', /If something goes wrong/, 'the troubleshooting list is named as on the page'],
  ],
  gaps: [/Deleting, moving, cleaning up or fixing anything other than the fixed Safe clean-up list/, /Recovering anything Safe clean-up removed/, /different computer/, /real time/, /malware/, /SMART/, /without the helper|Running without the helper/],
  rules: [/only thing it can ever change is the short fixed list/, /read-only helper/, /only the admin account/],
  system: [/never fixes anything except through Safe clean-up/, /never give a delete or cleanup command/, /Never promise that Safe clean-up will fix a full drive/],
}).catch((e) => { console.error(e); process.exit(1); });
