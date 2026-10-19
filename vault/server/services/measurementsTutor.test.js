'use strict';

// node server/services/measurementsTutor.test.js   (npm run test:measurements-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./measurementsTutor');

checkGuide({
  name: 'measurementsTutor',
  service,
  askName: 'askMeasurementsTutor',
  feature: 'measurements_guide',
  toolsFile: 'measurements/measurementsTools.mjs',
  menuExport: 'MEASUREMENT_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'convert',
  exampleStepId: 'scan-export',
  facts: [
    ['convert', 'does', /every unit of that kind/, 'the converter lists every unit'],
    ['say-it', 'does', /Use this/, 'speech is confirmed before it is used'],
    ['ingredient', 'notes', /approximate/, 'densities are approximate'],
    ['cup-standard', 'does', /250 ml cup, 20 ml tablespoon/, 'the Australian default is stated'],
    ['temperature-mode', 'does', /Absolute.*Difference/s, 'both temperature modes are named'],
    ['precision', 'does', /Sig\. figs.*Decimals/s, 'both precision modes are named'],
    ['formulas', 'does', /Conversion type/, 'the filters are named as on the page'],
    ['scan', 'notes', /nothing is uploaded/, 'documents are not uploaded'],
    ['scan-review', 'does', /Accept all clear ones/, 'the bulk button is named as on the page'],
    ['scan-review', 'notes', /Nothing is converted until accepted/, 'nothing converts until accepted'],
    ['scan-export', 'does', /Annotated PDF/, 'the PDF export is named as on the page'],
  ],
  gaps: [/Currency/, /scale tool/, /handwriting/i, /Saving a scanned document/, /new unit or changing a conversion factor/],
  rules: [/never converts anything on its own/, /never uploaded/, /no Convert button/i],
  system: [/never do the conversion yourself/],
}).catch((e) => { console.error(e); process.exit(1); });
