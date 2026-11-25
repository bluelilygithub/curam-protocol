'use strict';

// node server/services/devicePreviewTutor.test.js   (npm run test:device-preview-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./devicePreviewTutor');

checkGuide({
  name: 'devicePreviewTutor',
  service,
  askName: 'askDevicePreviewTutor',
  feature: 'device_preview_guide',
  toolsFile: 'devicePreview/devicePreviewTools.mjs',
  menuExport: 'DEVICE_PREVIEW_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'show',
  exampleStepId: 'choose-screens',
  facts: [
    ['address', 'notes', /login/, 'a page that needs a login cannot be loaded'],
    ['script-option', 'notes', /without its scripts/, 'the page is shown without its scripts'],
    ['show', 'notes', /Nothing is saved/, 'showing a page saves nothing'],
    ['choose-screens', 'does', /Up to four screens/, 'the limit of four is stated'],
    ['own-size', 'notes', /200 and 4000/, 'the size limits are stated'],
    ['turn', 'notes', /never turned/, 'laptops and monitors are not turned'],
    ['size-on-screen', 'notes', /real width/, 'the zoom does not change the width the page sees'],
    ['country-list', 'notes', /Up to 12 countries/, 'the country limit is stated'],
    ['country-screens', 'notes', /at most 24 pictures/, 'the picture cap is stated'],
    ['country-results', 'does', /Unverified: exited from XX/, 'the exit label is explained'],
    ['country-differences', 'notes', /not AI/, 'the differences are plain rules'],
    ['country-summary', 'notes', /can be wrong/, 'the AI summary is not trusted blindly'],
    ['country-saved', 'does', /recycle bin for 30 days/, 'delete goes to the bin'],
  ],
  gaps: [/Style editor/, /scripts to run/, /login/, /Real phones/, /Page speed/, /Saving a Screens view/, /on a schedule/],
  rules: [/At most four screens/, /without its scripts/, /nothing is saved/, /Countries checks are saved/],
  system: [/Never state or guess how a particular page will look/],
}).catch((e) => { console.error(e); process.exit(1); });
