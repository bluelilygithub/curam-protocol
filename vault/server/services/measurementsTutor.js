'use strict';

// The Measurements guide (the round button on Vault's /measurements page): a person says what they want to do ("how many grams is a cup
// of flour", "convert every size in this spec sheet", "why does it say US gallon") and the guide points at the real tools and controls,
// in order, or says plainly that Measurements does not do it. It only knows what is written here and it never sees any value, document
// or result. Built on guideCore.js; the ids are the page's own, listed in client/src/pages/measurements/measurementsTools.mjs (a test
// keeps the two in step). See docs/guide-chat.md and docs/measurement-converter.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'convert', label: 'Converter', group: 'Convert',
    does: 'Pick a kind of measurement along the top (length, volume, mass, temperature, cooking and more), type a value, and choose the unit you have and the unit you want. The result updates as you go, shows the formula used with a link to its full entry, and below it lists the value in every unit of that kind and your recent conversions. The swap button flips the two units. Feet and inches, and stones and pounds, show two boxes.',
    notes: 'Metric units come first; US and imperial units are all there, and US and imperial gallons are kept separate. Your choices and recent conversions are saved to your Vault account.' },
  { id: 'say-it', label: 'Say it', group: 'Convert',
    does: 'The microphone in the "Say it" box at the top of the Converter takes a whole conversion in one sentence, such as "five feet eleven in centimetres" or "two cups of flour in grams". It shows what it understood first; press Use this to fill the converter, and you can still change anything.',
    notes: 'Needs a browser with speech recognition (Chrome, Edge or Safari). Typing always works. It never converts until you press Use this.' },
  { id: 'ingredient', label: 'Ingredient', group: 'Convert',
    does: 'When you convert cups or spoons into grams (or the other way), an Ingredient box appears in the Converter. Pick or say the ingredient, such as flour or butter, because a cup of one weighs a different amount from a cup of another.',
    notes: 'The densities are typical baking-chart values and are approximate. It only appears for volume to weight conversions of cooking measures.' },
  { id: 'cup-standard', label: 'Cup standard', group: 'Convert',
    does: 'When cups or spoons are involved, the Cup standard switch chooses what a cup, tablespoon and teaspoon mean: Australian by default (250 ml cup, 20 ml tablespoon), or the US or the UK size. Hover a choice to see its sizes. The Document scanner has its own copy of this switch.',
    notes: 'It only appears when a cup or spoon is involved.' },
  { id: 'temperature-mode', label: 'Temperature mode', group: 'Convert',
    does: 'When you convert a temperature, the Temperature switch picks Absolute (a reading, so 20 °C is 68 °F) or Difference (a change, so a rise of 10 °C is a rise of 18 °F).',
    notes: 'It only appears for temperatures. Use Absolute for ovens and weather and Difference for "how much hotter".' },
  { id: 'precision', label: 'Precision', group: 'Convert',
    does: 'The Precision switch in the Converter chooses how the answer is rounded: Sig. figs (significant figures) or Decimals (decimal places), and the box beside it sets how many digits, from 0 to 12.',
    notes: 'It changes only how the answer is shown, not the maths.' },
  { id: 'formulas', label: 'Formulas', group: 'Look up',
    does: 'Browse or search every unit by name, symbol or nickname (for example feet, psi or fl oz). Filter by Group (kind of measurement), Conversion type (factor, offset, inverse or lookup table) and System (metric, US or imperial). Each entry shows the exact factor, the source, a worked example and a warning where look-alike units differ, with a box to try a value right there and a button to use that unit in the Converter. A table of ingredient densities sits at the bottom.',
    notes: 'It explains the conversions; it does not add units or change a factor.' },
  { id: 'scan', label: 'Document scanner', group: 'Documents',
    does: 'Drop a PDF, a JPG or PNG photo or screenshot onto the box (or choose a file), or paste text into the box below and press Scan text. It reads the text, running text recognition on scanned pages, finds measurements (fractions, ranges, sizes like 1200 × 600 × 18 mm, feet and inches, table columns with the unit in the heading) and proposes conversions. Unclear ones are flagged and nothing is converted until you accept it. A progress bar shows while it works, with a Cancel button.',
    notes: 'Everything is read on this device and nothing is uploaded. Text recognition downloads its language data once. Handwriting and drawn dimensions on plans are not read.' },
  { id: 'scan-settings', label: 'Scanner settings', group: 'Documents',
    does: 'Above the results, four choices tell the scanner how to read the document: Convert to (Metric, US or Imperial), Volumes in the document are (Imperial / AU / UK or US, because pints and gallons differ), Cup standard, and This is a (the kind of document, which helps with unclear units such as m, T, oz and the " mark).',
    notes: 'Set them before scanning; changing the target system afterwards changes the proposed conversions.' },
  { id: 'scan-review', label: 'Review the finds', group: 'Documents',
    does: 'After a scan, the Review list shows every measurement found, with its proposed conversion. For each one you can Accept, Fix (type or say the right number or unit), or Ignore. There are bulk buttons too: Accept all clear ones (high confidence, nothing flagged), Accept all or Ignore all for one kind of measurement, and Reset choices. The Annotated view shows the original page with every measurement highlighted.',
    notes: 'Nothing is converted until accepted. A flagged find (for example a " that could be inches or a quote mark) always needs a choice from you.' },
  { id: 'scan-export', label: 'Export the result', group: 'Documents',
    does: 'Under the review list: Copy converted text (the document text with the accepted conversions put in), Text file, CSV (every measurement found, with the converted value, confidence and page), and Annotated PDF (the original pages with measurements boxed and the converted values beside them).',
    notes: 'The copy and the text file contain only accepted conversions. Annotated PDF needs a PDF or image; pasted text has no pages.' },
];

const RULES = [
  'Pick the tool in the list on the left: Converter for one value, Formulas to look up how a conversion works, Document scanner for a whole document.',
  'The Converter updates as the value is typed. There is no Convert button.',
  'The "Say it" box takes a whole conversion in one sentence and shows what was understood before it is used. Every other box with a microphone takes just that field.',
  'Cups and spoons need a cup standard (Australian by default) and need an ingredient to become grams.',
  'The scanner never converts anything on its own: every find is accepted, fixed or ignored by the person, and unclear units are flagged.',
  'Documents are read on this device and are never uploaded. Only preferences and recent conversions are saved to the account.',
  'The Open buttons in this chat only switch to a tool; they never convert or scan anything by themselves.',
];

const NOT_POSSIBLE = [
  'Currency conversion or exchange rates.',
  'Time zones, dates or clothing and shoe sizes.',
  'Measuring a line drawn on a plan or a photo: there is no scale tool (that would need a scale such as 1:100).',
  'Reading handwriting, or text in a language the text recognition has not been given.',
  'Adding a new unit or changing a conversion factor.',
  'Saving a scanned document or its results in Vault: only the person\'s choices and recent conversions are saved, so export a result before leaving the page.',
  'Checking that a document\'s own numbers are right: it converts what is written, it does not check it.',
];

const SYSTEM = `You are the guide to Measurements in Vault for one person who converts units, looks up formulas and scans documents for measurements. They say, in everyday words, what they want to do. You point them to the right tool(s) and controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Measurements cannot do.
- You cannot see any value, document or result. Never state or guess what is in them, and never do the conversion yourself in place of the tool: point at the tool.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about which tool fits: Converter for one value, Formulas to see how or why a conversion works, Document scanner for a PDF, photo or pasted text with many measurements.
- If they ask about cooking, remember the Ingredient and Cup standard controls; if about temperatures, the Temperature switch.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Measurements guide', feature: 'measurements_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'MEASUREMENTS TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to convert or find, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askMeasurementsTutor: guide.ask,
};
