// What the Measurements page shows in its left-hand list, the hover text for it, and the controls its guide (the round button) can
// point at. The ids are the guide's catalogue (server/services/measurementsTutor.js); npm run test:measurements-tutor fails if the
// two lists drift apart. `tool` is the page the guide's Open button switches to.

export const MEASUREMENT_TOOLS = [
  { id: 'convert', label: 'Converter', group: 'Convert', icon: 'ruler', tour: 'measure-tab-convert' },
  { id: 'formulas', label: 'Formulas', group: 'Look up', icon: 'book', tour: 'measure-tab-formulas' },
  { id: 'scan', label: 'Document scanner', group: 'Documents', icon: 'scan-search', tour: 'measure-tab-scan' },
];

export const GROUPS = ['Convert', 'Look up', 'Documents'];

export const GROUP_TIPS = {
  Convert: 'Change one value from one unit to another, by typing it or saying it.',
  'Look up': 'See the exact factor, source and a worked example behind every conversion.',
  Documents: 'Find the measurements in a PDF, photo or pasted text and convert them for you to review.',
};

export const TOOL_TIPS = {
  convert: 'Convert one value between units: length, volume, mass, temperature, cooking and more. Type or say it, and see the formula used.',
  formulas: 'Browse or search every unit and the formula behind it: the exact factor, the source, a worked example, and warnings for look-alike units.',
  scan: 'Drop a PDF, photo or screenshot, or paste text. It finds the measurements and proposes conversions, and nothing changes until you accept it.',
};

// One short line shown under the page title for the open tool.
export const TOOL_BLURBS = {
  convert: 'Convert any measurement. Type a value or say a whole conversion.',
  formulas: 'Every conversion comes from this list: the factor, the source and an example.',
  scan: 'Find measurements in a document and convert them, with you checking each one.',
};

// The longer text for the (i) "How Measurements works" box.
export const HOW_IT_WORKS = [
  ['Converter', 'Pick a kind of measurement, type or say a value, choose the two units. The result updates as you go, shows the formula used, and lists the value in every unit of that kind. Cups and spoons follow the cup standard you pick (Australian by default: 250 ml cup, 20 ml tablespoon). Converting cups or spoons to grams needs an ingredient.'],
  ['Formulas', 'Every conversion comes from one list: the exact factor, the source, a worked example, and a warning where look-alike units differ (US vs imperial gallons, KB vs KiB). Each result links back to its entry. Ingredient densities are typical baking-chart values and are approximate.'],
  ['Document scanner', 'Drop a PDF, photo or screenshot, or paste text. Vault reads the text (running text recognition on scanned pages), finds measurements — fractions, ranges, sizes like 1200 × 600 × 18 mm, feet and inches, table columns with the unit in the heading — and proposes conversions. Unclear ones are flagged for you (a ” could be inches or a quote mark; m could be metres or minutes; oz weight or fluid). Nothing is converted until you accept it.'],
  ['Voice', 'The microphone is on the “Say it” box, the search boxes, pasted text and scan corrections. Say a whole conversion (“five feet eleven in centimetres”) and you see what was understood before it is used. Voice needs a browser with speech recognition (Chrome, Edge, Safari); typing always works.'],
  ['Privacy', 'Documents are read on this device. Nothing you scan is uploaded. Text recognition downloads its language data once, then is cached by the browser. Only your preferences and recent conversions are saved to your Vault account — never document contents.'],
  ['Not included yet', 'Currency, time zones, clothing sizes, and measuring drawn lines on plans (that needs a scale you set, like 1:100).'],
];

// Everything the guide can point at: the three tools plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'convert', label: 'Converter', tool: 'convert' },
  { id: 'say-it', label: 'Say it', tool: 'convert' },
  { id: 'ingredient', label: 'Ingredient', tool: 'convert' },
  { id: 'cup-standard', label: 'Cup standard', tool: 'convert' },
  { id: 'temperature-mode', label: 'Temperature mode', tool: 'convert' },
  { id: 'precision', label: 'Precision', tool: 'convert' },
  { id: 'formulas', label: 'Formulas', tool: 'formulas' },
  { id: 'scan', label: 'Document scanner', tool: 'scan' },
  { id: 'scan-settings', label: 'Scanner settings', tool: 'scan' },
  { id: 'scan-review', label: 'Review the finds', tool: 'scan' },
  { id: 'scan-export', label: 'Export the result', tool: 'scan' },
];
