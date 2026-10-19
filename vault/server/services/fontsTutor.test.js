'use strict';

// node server/services/fontsTutor.test.js   (npm run test:fonts-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./fontsTutor');

checkGuide({
  name: 'fontsTutor',
  service,
  askName: 'askFontsTutor',
  feature: 'fonts_guide',
  toolsFile: 'fonts/fontsTools.mjs',
  menuExport: 'FONT_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'shape',
  exampleStepId: 'download',
  facts: [
    ['font', 'does', /OFL/, 'only open-licence fonts are offered'],
    ['font', 'notes', /cannot upload your own font/, 'no uploading'],
    ['shape', 'does', /Stem Thickness.*Proportional Width.*Extend Ascenders\/Descenders.*Counter Width/s, 'the four sliders are named as on the page'],
    ['kerning', 'does', /Visual Balance & Rhythm/, 'the kerning slider is named as on the page'],
    ['effect', 'notes', /not in the downloaded font/, 'effects are preview only'],
    ['save', 'does', /Update/, 'saving a reopened font says Update'],
    ['settings', 'does', /Save preset/, 'the button is called Save preset'],
    ['settings', 'notes', /this browser only/, 'saved settings stay in the browser'],
    ['download', 'does', /new family name \(required\)/, 'a new name is required'],
    ['download', 'notes', /basic Latin and Western accented letters only/, 'the download is Latin only'],
    ['download', 'notes', /Nothing is stored/, 'nothing is kept after the download'],
  ],
  gaps: [/Uploading your own font file/, /Other alphabets/, /variable font/, /effect into the downloaded font/, /Licence or legal advice/],
  rules: [/Start with Choose a font/, /actual changed font, not an approximation/, /new family name is required/],
  system: [/cannot see any font or preview/, /choose a font first/],
}).catch((e) => { console.error(e); process.exit(1); });
