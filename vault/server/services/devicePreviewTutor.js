'use strict';

// The Device preview guide (the round button on Vault's /device-preview page): a person says what they want to check ("does my page work on
// an iPhone", "see it on a tablet on its side", "I want a size that is not in the list") and the guide points at the real controls, in order,
// or says plainly that Device preview does not do it. It only knows what is written here and it never sees any address typed or any page.
// Built on guideCore.js; the ids are the page's own, listed in client/src/pages/devicePreview/devicePreviewTools.mjs (a test keeps the two
// in step). See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'address', label: 'Address box', group: 'Show a page',
    does: 'The box at the top. Type the address of a public web page, such as https://www.example.com/, or say it with the microphone. Press Enter or the Show the page button to load it.',
    notes: 'It must be a page anyone can open. A page that needs a login cannot be loaded.' },
  { id: 'script-option', label: 'Builds itself with JavaScript', group: 'Show a page',
    does: 'A tick box under the address. Tick it if the page comes up empty or half-built: the page is opened in a real browser first so its scripts can build it. It is slower and limited to a few an hour.',
    notes: 'It is only offered when the server is set up for it. Even then the page is shown without its scripts, so menus that open and sliders will not work.' },
  { id: 'show', label: 'Show the page', group: 'Show a page',
    does: 'Loads the page and its style files and shows it on every screen chosen below. Press it again with a different address to look at another page.',
    notes: 'It only looks. Nothing is saved and nothing on the page is changed.' },
  { id: 'choose-screens', label: 'Choose screens', group: 'Choose screens',
    does: 'Rows of buttons for Phones (iPhone SE to iPhone 16 Pro Max, Samsung Galaxy, Google Pixel), Tablets (iPad mini, iPad, iPad Air, iPad Pro, Galaxy Tab, Pixel Tablet, Surface Pro) and Laptops and monitors. Tap one to show it and tap it again to remove it. Each shows its width and height. Up to four screens at once.',
    notes: 'Each screen is drawn at the real width of that device, so the page changes shape the way it does there. Sizes are the published screen sizes in CSS pixels; a real phone also has browser bars that use some of the height.' },
  { id: 'own-size', label: 'Your own size', group: 'Choose screens',
    does: 'Two boxes for a width and a height in pixels, and an Add button. The size joins the list and is shown. Up to three of your own sizes; each can be removed with its small x.',
    notes: 'Sizes must be between 200 and 4000 pixels.' },
  { id: 'turn', label: 'Turn on its side', group: 'Choose screens',
    does: 'The phone-symbol button under the choices holds phones and tablets on their side, so a phone becomes wider than it is tall. Press it again to stand them upright.',
    notes: 'Laptops and monitors are never turned.' },
  { id: 'size-on-screen', label: 'Size on screen', group: 'Choose screens',
    does: 'The Fit, 100%, 75% and 50% buttons choose how big each screen is drawn on your page. Fit shrinks each one so it fits without scrolling down. 100% is the real size, which can need scrolling sideways.',
    notes: 'This only changes how big it is drawn. The page still sees the real width of the device.' },
];

const RULES = [
  'Type the address, press Show the page, then choose the screens. Choosing a screen after the page is loaded shows it straight away.',
  'At most four screens are shown at once; remove one to add another.',
  "Every screen is an exact copy of the page at that device's width, so layout rules for small screens switch on just as they do on the real device.",
  'The page is shown without its scripts, and it only looks: nothing is saved and nothing on the page is changed.',
  'The Open buttons in this chat only switch to a tool (they scroll to its area); they never load a page or change a choice by themselves.',
];

const NOT_POSSIBLE = [
  "Changing the page's styling or fixing how it looks (use the Style editor, which has a device list of its own).",
  'Testing menus that open, sliders, forms or anything that needs the page\'s scripts to run.',
  'Pages that need a login or a password, or pages on a private network.',
  'Real phones and real browsers: sizes are close, not exact, and touch, fonts and browser bars are not reproduced.',
  'Checking how fast the page loads (use Page speed).',
  'Saving a comparison or sharing it with someone.',
];

const SYSTEM = `You are the guide to Device preview in Vault for one person who wants to see how a public web page looks on phones, tablets and monitors of different sizes. They say, in everyday words, what they want to check. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Device preview cannot do.
- You cannot see any address they typed or any page. Never state or guess how a particular page will look.
- Be plain and short, as to a friend who is not technical. Explain any web word (pixel, breakpoint) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they want to change how the page looks, say Device preview only looks and send them to the Style editor.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Device preview guide', feature: 'device_preview_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'DEVICE PREVIEW TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to check about the page, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askDevicePreviewTutor: guide.ask,
};
