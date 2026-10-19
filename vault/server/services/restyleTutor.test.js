'use strict';

// node server/services/restyleTutor.test.js   (npm run test:restyle-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./restyleTutor');

checkGuide({
  name: 'restyleTutor',
  service,
  askName: 'askRestyleTutor',
  feature: 'restyle_guide',
  toolsFile: 'restyle/restyleTools.mjs',
  menuExport: 'RESTYLE_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'ask',
  exampleStepId: 'download',
  // The tool's own rule: no code words in anything a person reads (docs/restyle.md). "CSS" is the tool's name and is allowed.
  noWords: /\b(padding|border-radius|selector|stylesheet|cascade|specificity|markup|DOM|class(?:es)? name)\b/i,
  facts: [
    ['page', 'does', /anything that could run code is removed/, 'the page is cleaned first'],
    ['page', 'notes', /no way to type in a web address/, 'no loading from an address'],
    ['styles', 'does', /files lower in the list win/, 'the order rule is stated'],
    ['build-preview', 'notes', /changes you have not saved are lost/, 'rebuilding drops unsaved changes'],
    ['saved', 'notes', /new saved copy/, 'every save makes a new copy'],
    ['select', 'notes', /does not follow it/, 'links are not followed in the preview'],
    ['ask', 'notes', /AI model/, 'the plain English box uses an AI model'],
    ['scope', 'does', /amber/, 'matching items are outlined in amber'],
    ['animation', 'does', /Fade in, Slide up, Pop in, Pulse and Bounce/, 'the six animations are named as on the page'],
    ['box', 'does', /outline glow/, 'the shadow choices are named as on the page'],
    ['undo', 'does', /one action/, 'undo goes by action'],
  ],
  gaps: [/typing its web address/, /layout structure/, /own scripts/, /pictures held on other websites/, /Updating a saved page in place/],
  rules: [/Build the preview/, /outlined in amber first/, /fixed list/],
  system: [/Use plain words only/, /bring in the page, build the preview, click something/],
}).catch((e) => { console.error(e); process.exit(1); });
