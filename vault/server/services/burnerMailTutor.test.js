'use strict';

// node server/services/burnerMailTutor.test.js   (npm run test:burner-mail-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./burnerMailTutor');

checkGuide({
  name: 'burnerMailTutor',
  service,
  askName: 'askBurnerMailTutor',
  feature: 'burner_mail_guide',
  toolsFile: 'burnerMail/burnerMailTools.mjs',
  menuExport: 'BURNER_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'make',
  exampleStepId: 'codes',
  facts: [
    ['make', 'does', /Make address/, 'the button is named as on the page'],
    ['keep', 'does', /1 day, 7 days.*30 days/s, 'the three lifetimes are named'],
    ['addresses', 'notes', /permanent/, 'deleting is permanent'],
    ['inbox', 'does', /every few seconds/, 'the inbox refreshes by itself'],
    ['codes', 'does', /Copy/, 'a code can be copied'],
    ['links', 'notes', /never opens a link/, 'links are never opened for the person'],
  ],
  gaps: [/Sending email/, /Filling in the sign-up form/, /refuses to accept/, /extending an address/, /safe or a scam/, /Forwarding/],
  rules: [/never opens a link/, /no refresh button/, /plain text/],
  system: [/never say a link or email is safe or unsafe/],
}).catch((e) => { console.error(e); process.exit(1); });
