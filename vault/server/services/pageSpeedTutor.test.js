'use strict';

// node server/services/pageSpeedTutor.test.js   (the Page speed guide). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./pageSpeedTutor');

checkGuide({
  name: 'pageSpeedTutor',
  service,
  askName: 'askPageSpeedTutor',
  feature: 'page_speed_guide',
  toolsFile: 'pageSpeed/pageSpeedTools.mjs',
  menuExport: 'PAGE_SPEED_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'report',
  exampleStepId: 'actions',
  facts: [
    ['new-run', 'notes', /public/, 'only public pages can be tested'],
    ['mobile-desktop', 'does', /Report and the Actions tabs follow/, 'both tabs follow the device'],
    ['scores', 'does', /90 to 100 is green/, 'score bands are explained'],
    ['field-data', 'notes', /enough Chrome visitors/, 'field data needs traffic'],
    ['actions', 'does', /Fix first, Do next and When there is time/, 'action groups are named'],
    ['action-done', 'notes', /saved with the run/, 'ticks are saved on the run'],
    ['action-done', 'notes', /do not re-test/, 'ticks do not re-test'],
    ['pdf-report', 'does', /Still to do or Done only/, 'pdf filters are named'],
    ['pdf-report', 'notes', /not emailed/, 'pdf is downloaded, not emailed'],
  ],
  gaps: [/Fixing or changing the website/, /behind a login/, /whole site/, /schedule/, /Emailing the PDF/],
  rules: [/never changes the website/, /Fix mobile first/],
  system: [/Never state or guess a score/],
}).catch((e) => { console.error(e); process.exit(1); });
